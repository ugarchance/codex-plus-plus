const PLAN_WEIGHTS = {
  free: 1,
  go: 1,
  plus: 10,
  team: 10,
  business: 10,
  self_serve_business_prolite: 50,
  self_serve_business_usage_based: 10,
  ent26: 10,
  enterprise_cbp_automation: 10,
  enterprise_cbp_usage_based: 10,
  enterprise: 10,
  edu: 10,
  prolite: 50,
  pro: 200
};

function weightFor(planType) {
  if (typeof planType !== "string") return 1;
  const normalized = planType.trim().toLowerCase();
  return PLAN_WEIGHTS[normalized] ?? 1;
}

module.exports = {
  PLAN_WEIGHTS,
  weightFor
};
