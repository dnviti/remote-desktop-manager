import { fireEvent, waitFor } from "@testing-library/dom";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DbMaskingSection from "./DbMaskingSection";

const {
  createMaskingPolicy,
  deleteMaskingPolicy,
  getMaskingPolicies,
  updateMaskingPolicy,
} = vi.hoisted(() => ({
  createMaskingPolicy: vi.fn(),
  deleteMaskingPolicy: vi.fn(),
  getMaskingPolicies: vi.fn(),
  updateMaskingPolicy: vi.fn(),
}));

vi.mock("../../api/dbAudit.api", async () => {
  const actual = await vi.importActual<typeof import("../../api/dbAudit.api")>(
    "../../api/dbAudit.api",
  );
  return {
    ...actual,
    createMaskingPolicy,
    deleteMaskingPolicy,
    getMaskingPolicies,
    updateMaskingPolicy,
  };
});

describe("DbMaskingSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getMaskingPolicies.mockResolvedValue([
      {
        id: "mask-1",
        tenantId: "tenant-1",
        name: "Existing Mask",
        columnPattern: "(email|phone)",
        strategy: "PARTIAL",
        exemptRoles: ["OWNER"],
        scope: null,
        description: "Existing masking rule",
        enabled: true,
        createdAt: "2026-04-07T12:00:00.000Z",
        updatedAt: "2026-04-07T12:00:00.000Z",
      },
    ]);
    createMaskingPolicy.mockResolvedValue(undefined);
    updateMaskingPolicy.mockResolvedValue(undefined);
    deleteMaskingPolicy.mockResolvedValue(undefined);
  });

  it("loads masking policies and creates one from a template", async () => {
    render(<DbMaskingSection />);

    expect(await screen.findByText("Existing Mask")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Masking policies" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open actions for Existing Mask" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Policy" }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Start from a template" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Search presets..."), {
      target: { value: "credit card" },
    });
    fireEvent.click(screen.getByText("Mask Credit Cards"));
    await waitFor(
      () => {
        expect(screen.getByLabelText("Policy name")).toHaveValue(
          "Mask Credit Cards",
        );
      },
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Policy" }));

    await waitFor(
      () => {
        expect(createMaskingPolicy).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Mask Credit Cards",
            columnPattern: "(credit_card|card_number|pan|cc_number)",
            strategy: "PARTIAL",
          }),
        );
      },
      { timeout: 5000 },
    );
  }, 10000);
});
