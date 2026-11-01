use crate::*;

pub const MAX_RISK_CAP: u8 = 80;

#[near]
impl Gateflow {
    /// Creates a gateway owned by the caller; the attached deposit (at least one execution
    /// deposit) becomes its screening fuel.
    #[payable]
    pub fn create_gateway(&mut self, payout_to: AccountId, policy: Policy) -> GatewayId {
        validate_policy(&policy);
        require!(env::attached_deposit() >= self.execution_deposit, "attach at least one execution deposit");
        let id = self.gateways.len();
        self.gateways.push(Gateway {
            owner: env::predecessor_account_id(),
            payout_to,
            policy,
            fuel: env::attached_deposit(),
            invoices: 0,
            payments: 0,
        });
        id
    }

    pub fn set_policy(&mut self, gateway: GatewayId, policy: Policy) {
        validate_policy(&policy);
        self.owned_gateway_mut(gateway).policy = policy;
    }

    #[payable]
    pub fn fund(&mut self, gateway: GatewayId) {
        let g = self.gateway_mut(gateway);
        g.fuel = g.fuel.saturating_add(env::attached_deposit());
    }

    pub fn get_gateway(&self, gateway: GatewayId) -> Option<Gateway> {
        self.gateways.get(gateway).cloned()
    }
}

impl Gateflow {
    pub(crate) fn gateway_mut(&mut self, id: GatewayId) -> &mut Gateway {
        self.gateways.get_mut(id).unwrap_or_else(|| env::panic_str("unknown gateway"))
    }

    pub(crate) fn owned_gateway_mut(&mut self, id: GatewayId) -> &mut Gateway {
        let g = self.gateway_mut(id);
        require!(g.owner == env::predecessor_account_id(), "not the gateway owner");
        g
    }
}

fn validate_policy(policy: &Policy) {
    require!(policy.max_risk <= MAX_RISK_CAP, "risk cap too high");
}

#[cfg(test)]
mod tests {
    use crate::testing::*;
    use near_sdk::test_utils::accounts;
    use near_sdk::NearToken;

    #[test]
    fn gateway_created_with_fuel() {
        let mut c = setup();
        call(&merchant(), NearToken::from_millinear(50), T0);
        assert_eq!(c.create_gateway(accounts(1), policy(50)), 0);
        let g = c.get_gateway(0).unwrap();
        assert_eq!(g.owner, merchant());
        assert_eq!(g.payout_to, accounts(1));
        assert_eq!(g.fuel, NearToken::from_millinear(50));
        assert_eq!((g.invoices, g.payments), (0, 0));
        call(&merchant(), NearToken::from_millinear(50), T0);
        assert_eq!(c.create_gateway(merchant(), policy(50)), 1);
    }

    #[test]
    #[should_panic(expected = "risk cap too high")]
    fn risk_cap_too_high() {
        let mut c = setup();
        call(&merchant(), NearToken::from_millinear(50), T0);
        c.create_gateway(merchant(), policy(90));
    }

    #[test]
    #[should_panic(expected = "risk cap too high")]
    fn risk_cap_too_high_on_update() {
        let mut c = with_gateway();
        c.set_policy(0, policy(90));
    }

    #[test]
    fn risk_cap_accepted() {
        let mut c = with_gateway();
        c.set_policy(0, policy(80));
        assert_eq!(c.get_gateway(0).unwrap().policy.max_risk, 80);
    }

    #[test]
    #[should_panic(expected = "not the gateway owner")]
    fn non_owner_cannot_set_policy() {
        let mut c = with_gateway();
        as_caller(&accounts(2));
        c.set_policy(0, policy(10));
    }

    #[test]
    fn fund_adds_fuel() {
        let mut c = with_gateway();
        call(&accounts(3), NearToken::from_millinear(100), T0);
        c.fund(0);
        assert_eq!(c.get_gateway(0).unwrap().fuel, NearToken::from_millinear(150));
        assert!(c.get_gateway(42).is_none());
    }

    #[test]
    #[should_panic(expected = "unknown gateway")]
    fn fund_unknown_gateway() {
        let mut c = with_gateway();
        call(&accounts(3), NearToken::from_millinear(100), T0);
        c.fund(42);
    }

    #[test]
    #[should_panic(expected = "attach at least one execution deposit")]
    fn gateway_without_fuel_rejected() {
        let mut c = setup();
        call(&merchant(), NearToken::from_millinear(9), T0);
        c.create_gateway(merchant(), policy(50));
    }
}
