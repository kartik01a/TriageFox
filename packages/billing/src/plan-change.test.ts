import { describe, expect, it } from "vitest";
import { changeKind, changeRequest, type PlanChoice } from "./plan-change";

const plan = (planId: string, monthlyPrice: number) => ({
  monthly: { planId, interval: "monthly", monthlyPrice } as PlanChoice,
  yearly: { planId, interval: "yearly", monthlyPrice } as PlanChoice,
});
const starter = plan("starter", 900);
const pro = plan("pro", 2400);
const business = plan("business", 5900);

describe("plan changes (ADR 0015)", () => {
  it("a bigger plan in the same billing period: charged the difference now, renewal date kept", () => {
    expect(changeKind(starter.monthly, pro.monthly)).toBe("now");
    expect(changeRequest(starter.monthly, pro.monthly)).toEqual({
      prorationMode: "prorated_immediately_keep_cycle",
      effectiveAt: "immediately",
    });
    expect(changeKind(pro.yearly, business.yearly)).toBe("now");
  });

  it("a smaller plan waits for the next billing date; nothing is charged today", () => {
    expect(changeKind(business.monthly, pro.monthly)).toBe("at_renewal");
    expect(changeRequest(business.yearly, starter.yearly)).toEqual({
      prorationMode: "full_immediately",
      effectiveAt: "next_billing_date",
    });
  });

  it("switching to yearly happens now, with credit for the unused time", () => {
    expect(changeKind(pro.monthly, pro.yearly)).toBe("now");
    expect(changeRequest(pro.monthly, pro.yearly)).toEqual({
      prorationMode: "prorated_immediately",
      effectiveAt: "immediately",
    });
  });

  it("switching to monthly waits for the end of the paid year", () => {
    expect(changeKind(pro.yearly, pro.monthly)).toBe("at_renewal");
  });

  it("a bigger plan on a different billing period starts now", () => {
    expect(changeKind(starter.yearly, business.monthly)).toBe("now");
    expect(changeRequest(starter.yearly, business.monthly)?.prorationMode).toBe(
      "prorated_immediately",
    );
    expect(changeKind(business.monthly, starter.yearly)).toBe("at_renewal");
  });

  it("choosing the plan you already have changes nothing", () => {
    expect(changeKind(pro.monthly, { ...pro.monthly })).toBe("same");
    expect(changeRequest(pro.monthly, { ...pro.monthly })).toBeNull();
  });
});
