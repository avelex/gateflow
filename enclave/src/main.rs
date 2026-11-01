//! OutLayer guest: stdin request in, `true` / `false` / `null` out. Built per network with `GATEFLOW_CONTRACT`.

#[cfg(target_os = "wasi")]
fn main() {
    use std::io::{Read, Write};

    let mut stdin = String::new();
    let _ = std::io::stdin().read_to_string(&mut stdin);
    let predecessor = std::env::var("NEAR_PREDECESSOR_ID").ok();
    let out = gateflow_enclave::run(&stdin, predecessor.as_deref(), env!("GATEFLOW_CONTRACT"), &http::fetch);
    let text = match out {
        Some(true) => "true",
        Some(false) => "false",
        None => "null",
    };
    let mut stdout = std::io::stdout();
    let _ = stdout.write_all(text.as_bytes());
    let _ = stdout.flush();
}

#[cfg(target_os = "wasi")]
mod http {
    use gateflow_enclave::flows::Http;
    use std::time::Duration;
    use wasi_http_client::Client;

    /// Larger bodies count as a failed fetch.
    const MAX_BODY: usize = 2 * 1024 * 1024;
    const CHUNK: u64 = 64 * 1024;

    /// `None` on any error, a non-2xx status, or a body above `MAX_BODY`.
    pub fn fetch(req: &Http) -> Option<String> {
        let client = Client::new();
        let builder = match &req.body {
            Some(body) => client.post(&req.url).header("content-type", "application/json").body(body.as_bytes()),
            None => client.get(&req.url),
        };
        // ponytail: only a connect timeout exists in wasi-http-client 0.2; OutLayer's 60 s run limit bounds the rest.
        let resp = builder.connect_timeout(Duration::from_secs(20)).send().ok()?;
        if !(200..300).contains(&resp.status()) {
            return None;
        }
        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk(CHUNK).ok()? {
            body.extend_from_slice(&chunk);
            if body.len() > MAX_BODY {
                return None;
            }
        }
        String::from_utf8(body).ok()
    }
}

#[cfg(not(target_os = "wasi"))]
fn main() {}
