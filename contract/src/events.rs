use near_sdk::env;
use near_sdk::serde_json::{json, Value};

/// Logs a NEP-297 event: `EVENT_JSON:{"standard":"gateflow","version":"1.0.0",...}`.
pub fn emit(event: &str, data: Value) {
    let body = json!({"standard": "gateflow", "version": "1.0.0", "event": event, "data": [data]});
    env::log_str(&format!("EVENT_JSON:{body}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::serde_json::json;
    use near_sdk::test_utils::get_logs;

    #[test]
    fn event_format() {
        emit("invoice_created", json!({"invoice": 0, "gateway": 0}));
        assert_eq!(
            get_logs()[0],
            r#"EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"invoice_created","data":[{"invoice":0,"gateway":0}]}"#
        );
    }
}
