use crate::*;
use near_sdk::serde_json::{json, Value};
use near_sdk::{Gas, Promise};

pub const OUTLAYER_GAS: Gas = Gas::from_tgas(100);
pub const SCREENED_CALLBACK_GAS: Gas = Gas::from_tgas(40);

impl Gateflow {
    /// Takes one execution deposit from the gateway's fuel, or panics.
    pub(crate) fn draw_fuel(&mut self, gateway: GatewayId) {
        let deposit = self.execution_deposit;
        let g = self.gateway_mut(gateway);
        require!(g.fuel >= deposit, "gateway has no fuel for screening");
        g.fuel = g.fuel.saturating_sub(deposit);
    }

    /// One OutLayer execution of the configured project with `request` as stdin, then `on_screened(payment)`.
    /// Shape per design decision 10.
    pub(crate) fn request_screening(&self, payment: PaymentId, request: Value) -> Promise {
        let args = json!({
            "source": {"Project": {"project_id": self.enclave.project, "version_key": null}},
            "resource_limits": {},
            "input_data": request.to_string(),
            "secrets_ref": {"profile": "default", "account_id": self.enclave.secrets_owner},
            "response_format": "Json",
            "payer_account_id": env::current_account_id(),
        });
        Promise::new(self.enclave.outlayer.clone())
            .function_call("request_execution", args.to_string().into_bytes(), self.execution_deposit, OUTLAYER_GAS)
            .then(Promise::new(env::current_account_id()).function_call(
                "on_screened",
                json!({"payment": payment}).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                SCREENED_CALLBACK_GAS,
            ))
    }
}
