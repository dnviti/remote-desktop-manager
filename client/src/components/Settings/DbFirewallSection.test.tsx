import { fireEvent, waitFor } from "@testing-library/dom";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DbFirewallSection from "./DbFirewallSection";

const {
  createFirewallRule,
  deleteFirewallRule,
  getFirewallRules,
  updateFirewallRule,
} = vi.hoisted(() => ({
  createFirewallRule: vi.fn(),
  deleteFirewallRule: vi.fn(),
  getFirewallRules: vi.fn(),
  updateFirewallRule: vi.fn(),
}));

vi.mock("../../api/dbAudit.api", async () => {
  const actual = await vi.importActual<typeof import("../../api/dbAudit.api")>(
    "../../api/dbAudit.api",
  );
  return {
    ...actual,
    createFirewallRule,
    deleteFirewallRule,
    getFirewallRules,
    updateFirewallRule,
  };
});

describe("DbFirewallSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getFirewallRules.mockResolvedValue([
      {
        id: "rule-1",
        tenantId: "tenant-1",
        name: "Existing Rule",
        pattern: "\\bDELETE\\b",
        action: "ALERT",
        scope: null,
        description: "Existing description",
        enabled: true,
        priority: 3,
        createdAt: "2026-04-07T12:00:00.000Z",
        updatedAt: "2026-04-07T12:00:00.000Z",
      },
    ]);
    createFirewallRule.mockResolvedValue(undefined);
    updateFirewallRule.mockResolvedValue(undefined);
    deleteFirewallRule.mockResolvedValue(undefined);
  });

  it("loads rules and creates a rule from a template", async () => {
    render(<DbFirewallSection />);

    expect(await screen.findByText("Existing Rule")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Firewall rules" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open actions for Existing Rule" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Rule" }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Start from a template" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Search presets..."), {
      target: { value: "drop table" },
    });
    fireEvent.click(screen.getByText("Block DROP TABLE"));
    await waitFor(() => {
      expect(screen.getByLabelText("Rule name")).toHaveValue(
        "Block DROP TABLE",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Rule" }));

    await waitFor(() => {
      expect(createFirewallRule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Block DROP TABLE",
          pattern: "\\bDROP\\s+TABLE\\b",
          action: "BLOCK",
          description: "Prevent accidental or hostile table deletion.",
        }),
      );
    });
  });
});
