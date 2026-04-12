import { fireEvent, waitFor } from "@testing-library/dom";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DbRateLimitSection from "./DbRateLimitSection";

const {
  createRateLimitPolicy,
  deleteRateLimitPolicy,
  getRateLimitPolicies,
  updateRateLimitPolicy,
} = vi.hoisted(() => ({
  createRateLimitPolicy: vi.fn(),
  deleteRateLimitPolicy: vi.fn(),
  getRateLimitPolicies: vi.fn(),
  updateRateLimitPolicy: vi.fn(),
}));

vi.mock("../../api/dbAudit.api", async () => {
  const actual = await vi.importActual<typeof import("../../api/dbAudit.api")>(
    "../../api/dbAudit.api",
  );
  return {
    ...actual,
    createRateLimitPolicy,
    deleteRateLimitPolicy,
    getRateLimitPolicies,
    updateRateLimitPolicy,
  };
});

describe("DbRateLimitSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getRateLimitPolicies.mockResolvedValue([
      {
        id: "policy-1",
        tenantId: "tenant-1",
        name: "Existing Limit",
        queryType: "SELECT",
        windowMs: 60000,
        maxQueries: 100,
        burstMax: 10,
        exemptRoles: ["ADMIN"],
        scope: null,
        action: "REJECT",
        enabled: true,
        priority: 2,
        createdAt: "2026-04-07T12:00:00.000Z",
        updatedAt: "2026-04-07T12:00:00.000Z",
      },
    ]);
    createRateLimitPolicy.mockResolvedValue(undefined);
    updateRateLimitPolicy.mockResolvedValue(undefined);
    deleteRateLimitPolicy.mockResolvedValue(undefined);
  });

  it("loads policies and creates one from a template", async () => {
    render(<DbRateLimitSection />);

    expect(await screen.findByText("Existing Limit")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Rate limit policies" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open actions for Existing Limit" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Policy" }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Start from a template" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Search presets..."), {
      target: { value: "ddl" },
    });
    fireEvent.click(screen.getByText("DDL Rate Limit"));
    await waitFor(
      () => {
        expect(screen.getByLabelText("Policy name")).toHaveValue(
          "DDL Rate Limit",
        );
      },
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Policy" }));

    await waitFor(
      () => {
        expect(createRateLimitPolicy).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "DDL Rate Limit",
            queryType: "DDL",
            windowMs: 300000,
            maxQueries: 5,
            burstMax: 2,
            action: "REJECT",
          }),
        );
      },
      { timeout: 5000 },
    );
  }, 10000);
});
