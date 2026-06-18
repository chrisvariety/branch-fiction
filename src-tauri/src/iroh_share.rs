use std::net::SocketAddr;
use std::pin::Pin;
use std::task::{Context, Poll};

use axum::extract::ConnectInfo;
use hyper_util::rt::TokioIo;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::protocol::{AcceptError, ProtocolHandler, Router as IrohRouter};
use iroh::{Endpoint, endpoint::presets::N0};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::Mutex;
use tower::ServiceExt;

use crate::phone_share::PhoneShareState;

// Must match PHONE_SHARE_ALPN in the branch-gateway repo (src/main.rs).
pub const PHONE_SHARE_ALPN: &[u8] = b"branchfiction/phone-share/1";

// iroh peers have no socket address; phone_share_guard only checks is_loopback, so any
// non-loopback placeholder admits them while a share is live (TEST-NET-1, RFC 5737).
// LOAD-BEARING: if the guard layer is reworked to authorize by ConnectInfo, this fake
// address must be revisited, as iroh requests will otherwise be misclassified as LAN/remote.
fn phone_peer_addr() -> SocketAddr {
    SocketAddr::from(([192, 0, 2, 1], 0))
}

// Binds the iroh endpoint lazily on first cloud-share, so only sharers announce to discovery.
pub struct IrohShareState {
    app: AppHandle,
    router: axum::Router,
    iroh: Mutex<Option<IrohRouter>>,
}

impl IrohShareState {
    pub fn new(app: AppHandle, router: axum::Router) -> Self {
        Self {
            app,
            router,
            iroh: Mutex::new(None),
        }
    }

    pub async fn ensure_endpoint(&self) -> Result<Endpoint, String> {
        let mut guard = self.iroh.lock().await;
        if guard.is_none() {
            let endpoint = Endpoint::builder(N0)
                .alpns(vec![PHONE_SHARE_ALPN.to_vec()])
                .bind()
                .await
                .map_err(|e| format!("iroh bind failed: {e}"))?;
            let proto = PhoneShareProtocol {
                app: self.app.clone(),
                router: self.router.clone(),
            };
            *guard = Some(
                IrohRouter::builder(endpoint)
                    .accept(PHONE_SHARE_ALPN, proto)
                    .spawn(),
            );
        }
        Ok(guard.as_ref().expect("just bound").endpoint().clone())
    }
}

#[derive(Clone, Debug)]
struct PhoneShareProtocol {
    app: AppHandle,
    router: axum::Router,
}

impl ProtocolHandler for PhoneShareProtocol {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        if !self.app.state::<PhoneShareState>().has_active() {
            connection.close(0u8.into(), b"no active share");
            return Ok(());
        }
        // One bi-stream per request; serve each over the existing axum router via hyper.
        while let Ok((send, recv)) = connection.accept_bi().await {
            let router = self.router.clone();
            tokio::spawn(serve_stream(router, send, recv));
        }
        Ok(())
    }
}

async fn serve_stream(router: axum::Router, send: SendStream, recv: RecvStream) {
    let io = TokioIo::new(IrohStream { send, recv });
    let service = hyper::service::service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
        let router = router.clone();
        async move {
            let mut req = req.map(axum::body::Body::new);
            req.extensions_mut().insert(ConnectInfo(phone_peer_addr()));
            router.oneshot(req).await
        }
    });
    if let Err(e) = hyper::server::conn::http1::Builder::new()
        .serve_connection(io, service)
        .await
    {
        eprintln!("iroh share: serve_connection error: {e}");
    }
}

// One iroh bi-stream as a single AsyncRead + AsyncWrite (mirrors dumbpipe-web's QuinnEndpoint).
struct IrohStream {
    send: SendStream,
    recv: RecvStream,
}

impl AsyncRead for IrohStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().recv).poll_read(cx, buf)
    }
}

impl AsyncWrite for IrohStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<Result<usize, std::io::Error>> {
        Pin::new(&mut self.get_mut().send)
            .poll_write(cx, buf)
            .map_err(Into::into)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), std::io::Error>> {
        Pin::new(&mut self.get_mut().send)
            .poll_flush(cx)
            .map_err(Into::into)
    }

    fn poll_shutdown(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        Pin::new(&mut self.get_mut().send)
            .poll_shutdown(cx)
            .map_err(Into::into)
    }
}
