use htmd::HtmlToMarkdown;

/// Batch HTML→Markdown via htmd; one IPC round-trip per book. Pre/post-processing stays in TS.
#[tauri::command]
pub async fn convert_html_to_markdown(htmls: Vec<String>) -> Vec<String> {
    let converter = HtmlToMarkdown::new();
    htmls
        .iter()
        .map(|html| converter.convert(html).unwrap_or_default())
        .collect()
}
