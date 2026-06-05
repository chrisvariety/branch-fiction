use std::collections::HashSet;

use serde::Serialize;

use crate::provider_proxy::AuthShape;

pub struct CatalogEntry {
    pub provider_type: &'static str,
    pub name: &'static str,
    pub base_url: &'static str,
    pub auth: AuthShape,
    pub api_key_placeholder: &'static str,
    pub env_var_placeholder: &'static str,
    pub pi_provider: Option<&'static str>,
    pub is_compatible_variant: bool,
    pub requires_base_url: bool,
}

// Built-in provider list mirroring pi-ai's catalog; read by the frontend via `get_provider_catalog`.
pub fn provider_catalog() -> Vec<CatalogEntry> {
    vec![
        CatalogEntry {
            provider_type: "google_gemini",
            name: "Google Gemini",
            base_url: "https://generativelanguage.googleapis.com/v1beta",
            auth: AuthShape::Header {
                header: "x-goog-api-key".to_string(),
            },
            api_key_placeholder: "AI...",
            env_var_placeholder: "GEMINI_API_KEY",
            pi_provider: Some("google"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "openai",
            name: "OpenAI",
            base_url: "https://api.openai.com/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "sk-...",
            env_var_placeholder: "OPENAI_API_KEY",
            pi_provider: Some("openai"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "openai_compatible",
            name: "OpenAI Compatible",
            base_url: "",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "sk-...",
            env_var_placeholder: "OPENAI_API_KEY",
            pi_provider: None,
            is_compatible_variant: true,
            requires_base_url: true,
        },
        CatalogEntry {
            provider_type: "anthropic",
            name: "Anthropic",
            base_url: "https://api.anthropic.com",
            auth: AuthShape::Header {
                header: "x-api-key".to_string(),
            },
            api_key_placeholder: "sk-ant-...",
            env_var_placeholder: "ANTHROPIC_API_KEY",
            pi_provider: Some("anthropic"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "anthropic_compatible",
            name: "Anthropic Compatible",
            base_url: "",
            auth: AuthShape::Header {
                header: "x-api-key".to_string(),
            },
            api_key_placeholder: "sk-ant-...",
            env_var_placeholder: "ANTHROPIC_API_KEY",
            pi_provider: None,
            is_compatible_variant: true,
            requires_base_url: true,
        },
        CatalogEntry {
            provider_type: "openrouter",
            name: "OpenRouter",
            base_url: "https://openrouter.ai/api/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "sk-or-...",
            env_var_placeholder: "OPENROUTER_API_KEY",
            pi_provider: Some("openrouter"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "xai",
            name: "xAI",
            base_url: "https://api.x.ai/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "xai-...",
            env_var_placeholder: "XAI_API_KEY",
            pi_provider: Some("xai"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "cerebras",
            name: "Cerebras",
            base_url: "https://api.cerebras.ai/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "csk-...",
            env_var_placeholder: "CEREBRAS_API_KEY",
            pi_provider: Some("cerebras"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "deepseek",
            name: "DeepSeek",
            base_url: "https://api.deepseek.com",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "sk-...",
            env_var_placeholder: "DEEPSEEK_API_KEY",
            pi_provider: Some("deepseek"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "fireworks",
            name: "Fireworks AI",
            base_url: "https://api.fireworks.ai/inference",
            auth: AuthShape::Header {
                header: "x-api-key".to_string(),
            },
            api_key_placeholder: "fw_...",
            env_var_placeholder: "FIREWORKS_API_KEY",
            pi_provider: Some("fireworks"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "groq",
            name: "Groq",
            base_url: "https://api.groq.com/openai/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "gsk_...",
            env_var_placeholder: "GROQ_API_KEY",
            pi_provider: Some("groq"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "huggingface",
            name: "Hugging Face",
            base_url: "https://router.huggingface.co/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "hf_...",
            env_var_placeholder: "HF_TOKEN",
            pi_provider: Some("huggingface"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "minimax",
            name: "MiniMax",
            base_url: "https://api.minimax.io/anthropic",
            auth: AuthShape::Header {
                header: "x-api-key".to_string(),
            },
            api_key_placeholder: "",
            env_var_placeholder: "MINIMAX_API_KEY",
            pi_provider: Some("minimax"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "mistral",
            name: "Mistral",
            base_url: "https://api.mistral.ai",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "",
            env_var_placeholder: "MISTRAL_API_KEY",
            pi_provider: Some("mistral"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "moonshotai",
            name: "Moonshot AI",
            base_url: "https://api.moonshot.ai/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "sk-...",
            env_var_placeholder: "MOONSHOT_API_KEY",
            pi_provider: Some("moonshotai"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "nvidia",
            name: "NVIDIA NIM",
            base_url: "https://integrate.api.nvidia.com/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "nvapi-...",
            env_var_placeholder: "NVIDIA_API_KEY",
            pi_provider: Some("nvidia"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "together",
            name: "Together AI",
            base_url: "https://api.together.ai/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "",
            env_var_placeholder: "TOGETHER_API_KEY",
            pi_provider: Some("together"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "vercel_ai_gateway",
            name: "Vercel AI Gateway",
            base_url: "https://ai-gateway.vercel.sh",
            auth: AuthShape::Header {
                header: "x-api-key".to_string(),
            },
            api_key_placeholder: "vck_...",
            env_var_placeholder: "AI_GATEWAY_API_KEY",
            pi_provider: Some("vercel-ai-gateway"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "xiaomi",
            name: "Xiaomi",
            base_url: "https://api.xiaomimimo.com/v1",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "",
            env_var_placeholder: "XIAOMI_API_KEY",
            pi_provider: Some("xiaomi"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "zai",
            name: "Z.AI",
            base_url: "https://api.z.ai/api/coding/paas/v4",
            auth: AuthShape::Bearer {
                header_prefix: None,
            },
            api_key_placeholder: "",
            env_var_placeholder: "ZAI_API_KEY",
            pi_provider: Some("zai"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
        CatalogEntry {
            provider_type: "ollama",
            name: "Ollama",
            base_url: "http://localhost:11434",
            auth: AuthShape::None,
            api_key_placeholder: "",
            env_var_placeholder: "",
            pi_provider: Some("ollama"),
            is_compatible_variant: false,
            requires_base_url: false,
        },
    ]
}

/// Lowercased auth header names the proxy always strips to prevent credential smuggling.
pub fn known_auth_header_names() -> HashSet<String> {
    let mut out: HashSet<String> = HashSet::new();
    for entry in provider_catalog() {
        match entry.auth {
            AuthShape::Bearer { .. } => {
                out.insert("authorization".to_string());
            }
            AuthShape::Header { header } => {
                out.insert(header.to_ascii_lowercase());
            }
            AuthShape::None | AuthShape::QueryParam { .. } | AuthShape::Body { .. } => {}
        }
    }
    out
}

/// Default base URL for a built-in provider type. Returns `None` for unknown
/// types and for compatible variants (which require a user-supplied URL).
pub fn base_url_for_type(provider_type: &str) -> Option<&'static str> {
    provider_catalog().into_iter().find_map(|e| {
        if e.provider_type == provider_type && !e.base_url.is_empty() {
            Some(e.base_url)
        } else {
            None
        }
    })
}

fn origin_of(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let scheme = parsed.scheme();
    let host = parsed.host_str()?;
    let port = parsed.port();
    Some(match port {
        Some(p) => format!("{scheme}://{host}:{p}"),
        None => format!("{scheme}://{host}"),
    })
}

fn auth_shapes_equal(a: &AuthShape, b: &AuthShape) -> bool {
    match (a, b) {
        (AuthShape::None, AuthShape::None) => true,
        (AuthShape::Bearer { header_prefix: h1 }, AuthShape::Bearer { header_prefix: h2 }) => {
            h1 == h2
        }
        (AuthShape::Header { header: h1 }, AuthShape::Header { header: h2 }) => h1 == h2,
        (AuthShape::QueryParam { param: p1 }, AuthShape::QueryParam { param: p2 }) => p1 == p2,
        (AuthShape::Body { field: f1 }, AuthShape::Body { field: f2 }) => f1 == f2,
        _ => false,
    }
}

/// Returns the catalog's provider `type` for a given `(origin, auth)` pair, or
/// `None` if no entry matches.
pub fn provider_type_for_origin_and_auth(base_url: &str, auth: &AuthShape) -> Option<&'static str> {
    let target = origin_of(base_url)?;
    provider_catalog().into_iter().find_map(|e| {
        if origin_of(e.base_url).as_deref() == Some(&target) && auth_shapes_equal(&e.auth, auth) {
            Some(e.provider_type)
        } else {
            None
        }
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCatalogEntryDto {
    #[serde(rename = "type")]
    type_: String,
    name: String,
    base_url: String,
    auth_shape: AuthShape,
    pi_provider: Option<String>,
    api_key_placeholder: String,
    env_var_placeholder: String,
    is_compatible_variant: bool,
    requires_base_url: bool,
}

#[tauri::command]
pub fn get_provider_catalog() -> Vec<ProviderCatalogEntryDto> {
    provider_catalog()
        .into_iter()
        .map(|e| ProviderCatalogEntryDto {
            type_: e.provider_type.to_string(),
            name: e.name.to_string(),
            base_url: e.base_url.to_string(),
            auth_shape: e.auth,
            pi_provider: e.pi_provider.map(str::to_string),
            api_key_placeholder: e.api_key_placeholder.to_string(),
            env_var_placeholder: e.env_var_placeholder.to_string(),
            is_compatible_variant: e.is_compatible_variant,
            requires_base_url: e.requires_base_url,
        })
        .collect()
}
