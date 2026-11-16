use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tiny_http::{Header, Response, Server};
use url::Url;

/// PKCE verifier and S256 challenge pair for OAuth 2.0 authorisation code flows.
#[derive(Debug, Clone)]
pub struct PkcePair {
    pub code_verifier: String,
    pub code_challenge: String,
}

/// Configuration for exchanging an OAuth 2.0 authorisation code for tokens.
#[derive(Debug, Clone)]
pub struct OAuthTokenConfig {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub token_url: String,
    pub redirect_uri: String,
    pub extra_params: Vec<(String, String)>,
}

/// Standard OAuth 2.0 token response payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
}

/// Escapes HTML special characters so untrusted strings (such as OAuth error descriptions)
/// can be safely embedded into callback HTML templates.
pub fn escape_html(input: &str) -> String {
    let mut escaped = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn sanitise_hex_colour(colour: &str) -> &str {
    let trimmed = colour.trim();
    if trimmed.starts_with('#')
        && matches!(trimmed.len(), 4 | 7 | 9)
        && trimmed[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        trimmed
    } else {
        "#22c55e"
    }
}

const SHARED_CALLBACK_STYLES: &str = "\
* { box-sizing: border-box; margin: 0; padding: 0; }\
html, body { height: 100%; background: #09090b; color: #fafafa; font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif; -webkit-font-smoothing: antialiased; }\
body { display: flex; align-items: center; justify-content: center; padding: 24px; }\
.card { width: 100%; max-width: 400px; background: #18181b; border: 1px solid #27272a; border-radius: 14px; padding: 28px 28px 32px; text-align: center; box-shadow: 0 20px 44px rgba(0, 0, 0, 0.45); }\
.brand { display: inline-flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 22px; font-size: 13px; font-weight: 600; color: #e4e4e7; letter-spacing: -0.01em; }\
.badge { width: 52px; height: 52px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; margin: 0 auto 18px; }\
h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; color: #fafafa; margin-bottom: 8px; }\
p { font-size: 14px; line-height: 1.5; color: #a1a1aa; }\
.error-box { margin: 14px 0; padding: 10px 12px; border-radius: 8px; background: #09090b; border: 1px solid #27272a; color: #fca5a5; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.45; word-break: break-word; text-align: left; }";

const BRAND_HEADER_HTML: &str = "\
<div class=\"brand\">\
<svg width=\"24\" height=\"24\" viewBox=\"80 80 864 864\" fill=\"none\" aria-hidden=\"true\">\
<rect x=\"84\" y=\"84\" width=\"856\" height=\"856\" rx=\"205\" fill=\"#18181B\" stroke=\"#3F3F46\" stroke-width=\"16\" />\
<polygon points=\"752,272 272,460 460,536\" fill=\"#FAFAFA\" />\
<polygon points=\"752,272 488,564 564,752\" fill=\"#FAFAFA\" />\
<polygon points=\"752,272 460,536 488,564\" fill=\"#A1A1AA\" />\
</svg>\
<span>SocialPoster</span>\
</div>";

/// Renders a self-contained dark-themed HTML confirmation page for completed OAuth logins.
pub fn render_success_page(platform_name: &str, accent_colour: &str) -> String {
    let safe_name = escape_html(platform_name);
    let safe_colour = sanitise_hex_colour(accent_colour);

    format!(
        "<!DOCTYPE html>\
<html lang=\"en\">\
<head>\
<meta charset=\"utf-8\" />\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\
<title>Connected to {safe_name}</title>\
<style>{SHARED_CALLBACK_STYLES}</style>\
</head>\
<body>\
<main class=\"card\">\
{BRAND_HEADER_HTML}\
<div class=\"badge\" style=\"background: {safe_colour}24; border: 1px solid {safe_colour}66; color: {safe_colour};\">\
<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><polyline points=\"20 6 9 17 4 12\"></polyline></svg>\
</div>\
<h1>Connected to {safe_name}</h1>\
<p>You can close this tab and return to SocialPoster.</p>\
</main>\
<script>setTimeout(() => {{ try {{ window.close(); }} catch (_) {{}} }}, 1500);</script>\
</body>\
</html>"
    )
}

/// Renders a self-contained dark-themed HTML error page when an OAuth login fails or is denied.
pub fn render_error_page(platform_name: &str, error_message: &str) -> String {
    let safe_name = escape_html(platform_name);
    let safe_error = escape_html(error_message);

    format!(
        "<!DOCTYPE html>\
<html lang=\"en\">\
<head>\
<meta charset=\"utf-8\" />\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\
<title>{safe_name} connection failed</title>\
<style>{SHARED_CALLBACK_STYLES}</style>\
</head>\
<body>\
<main class=\"card\">\
{BRAND_HEADER_HTML}\
<div class=\"badge\" style=\"background: #ef444424; border: 1px solid #ef444466; color: #ef4444;\">\
<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"></line><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"></line></svg>\
</div>\
<h1>{safe_name} connection failed</h1>\
<div class=\"error-box\">{safe_error}</div>\
<p>Close this tab and try again in SocialPoster.</p>\
</main>\
</body>\
</html>"
    )
}

/// Generates a cryptographically random PKCE code verifier and its S256 challenge.
pub fn generate_pkce() -> Result<PkcePair, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|err| format!("Failed to generate PKCE randomness: {err}"))?;

    let code_verifier = URL_SAFE_NO_PAD.encode(bytes);
    let digest = Sha256::digest(code_verifier.as_bytes());
    let code_challenge = URL_SAFE_NO_PAD.encode(digest);

    Ok(PkcePair {
        code_verifier,
        code_challenge,
    })
}

/// Generates a cryptographically random OAuth `state` parameter for CSRF protection.
pub fn generate_state() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    getrandom::getrandom(&mut bytes)
        .map_err(|err| format!("Failed to generate OAuth state: {err}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Binds an ephemeral local HTTP loopback listener on `127.0.0.1` and returns the
/// bound `Server` together with its `http://127.0.0.1:<port>/callback` redirect URI.
pub fn bind_loopback(preferred_port: Option<u16>) -> Result<(Server, String), String> {
    let port = preferred_port.unwrap_or(0);
    let server = Server::http(("127.0.0.1", port))
        .map_err(|err| format!("Failed to bind local OAuth loopback on 127.0.0.1:{port}: {err}"))?;

    let actual_port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or_else(|| "Loopback server did not bind to an IP address".to_string())?;

    let redirect_uri = format!("http://127.0.0.1:{actual_port}/callback");
    Ok((server, redirect_uri))
}

/// Waits on the bound `127.0.0.1` loopback server for the OAuth callback request,
/// validates `state` (when `expected_state` is `Some`), responds with a styled HTML
/// status page (`200 OK` or `400 Bad Request`), and returns the captured `code`.
pub async fn wait_for_callback_code(
    server: Server,
    expected_state: Option<String>,
    timeout: Duration,
    platform_name: &str,
    accent_colour: &str,
) -> Result<String, String> {
    let platform_name = platform_name.to_string();
    let accent_colour = accent_colour.to_string();

    tokio::task::spawn_blocking(move || {
        let deadline = std::time::Instant::now() + timeout;

        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err("Timed out waiting for OAuth callback on 127.0.0.1".to_string());
            }

            let maybe_request = server
                .recv_timeout(remaining)
                .map_err(|err| format!("OAuth loopback listener failed: {err}"))?;

            let Some(request) = maybe_request else {
                return Err("Timed out waiting for OAuth callback on 127.0.0.1".to_string());
            };

            let raw_url = request.url().to_string();
            // Ignore browser favicon probes while waiting for the actual callback.
            if raw_url.starts_with("/favicon.ico") {
                let _ = request.respond(Response::from_string("").with_status_code(404));
                continue;
            }

            let parsed = Url::parse(&format!("http://127.0.0.1{raw_url}"))
                .map_err(|err| format!("Invalid OAuth callback URL: {err}"))?;

            let mut code: Option<String> = None;
            let mut state: Option<String> = None;
            let mut error: Option<String> = None;
            let mut error_description: Option<String> = None;

            for (k, v) in parsed.query_pairs() {
                match k.as_ref() {
                    "code" => code = Some(v.into_owned()),
                    "state" => state = Some(v.into_owned()),
                    "error" => error = Some(v.into_owned()),
                    "error_description" => error_description = Some(v.into_owned()),
                    _ => {}
                }
            }

            if let Some(err_code) = error {
                let detail = error_description.unwrap_or_default();
                let err_message = if detail.is_empty() {
                    format!("OAuth provider returned error: {err_code}")
                } else {
                    format!("OAuth provider returned error: {err_code} ({detail})")
                };
                let _ = request.respond(html_response(
                    render_error_page(&platform_name, &err_message),
                    400,
                ));
                return Err(err_message);
            }

            if let Some(expected) = expected_state.as_deref()
                && state.as_deref() != Some(expected)
            {
                let err_message = "OAuth callback state mismatch.".to_string();
                let _ = request.respond(html_response(
                    render_error_page(&platform_name, &err_message),
                    400,
                ));
                return Err(err_message);
            }

            let Some(auth_code) = code.filter(|c| !c.is_empty()) else {
                let err_message =
                    "OAuth callback did not include an authorisation code.".to_string();
                let _ = request.respond(html_response(
                    render_error_page(&platform_name, &err_message),
                    400,
                ));
                return Err(err_message);
            };

            let _ = request.respond(html_response(
                render_success_page(&platform_name, &accent_colour),
                200,
            ));
            return Ok(auth_code);
        }
    })
    .await
    .map_err(|err| format!("OAuth callback task failed: {err}"))?
}

/// Exchanges an OAuth 2.0 authorisation code + PKCE verifier for access/refresh tokens.
pub async fn exchange_code_for_tokens(
    client: &reqwest::Client,
    config: &OAuthTokenConfig,
    code: &str,
    code_verifier: &str,
) -> Result<OAuthTokens, String> {
    let mut params: Vec<(&str, &str)> = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", &config.redirect_uri),
        ("client_id", &config.client_id),
        ("code_verifier", code_verifier),
    ];

    if let Some(secret) = config.client_secret.as_deref() {
        params.push(("client_secret", secret));
    }
    for (k, v) in &config.extra_params {
        params.push((k.as_str(), v.as_str()));
    }

    let response = client
        .post(&config.token_url)
        .form(&params)
        .send()
        .await
        .map_err(|err| format!("Token exchange request failed: {err}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Token exchange returned HTTP {status}: {body}"));
    }

    response
        .json::<OAuthTokens>()
        .await
        .map_err(|err| format!("Failed to parse OAuth token response: {err}"))
}

fn html_response(body: String, status_code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_string(body).with_status_code(status_code);
    if let Ok(header) = Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]) {
        response.add_header(header);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_html_special_characters() {
        assert_eq!(
            escape_html(r#"<script>alert("x" & 'y')</script>"#),
            "&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;"
        );
    }

    #[test]
    fn renders_dark_success_and_error_pages() {
        let ok_html = render_success_page("Mastodon", "#6364FF");
        assert!(ok_html.contains("Connected to Mastodon"));
        assert!(ok_html.contains("#6364FF"));
        assert!(ok_html.contains("window.close()"));

        let err_html = render_error_page("Mastodon", "access_denied <script>");
        assert!(err_html.contains("Mastodon connection failed"));
        assert!(err_html.contains("access_denied &lt;script&gt;"));
        assert!(!err_html.contains("access_denied <script>"));
    }
}
