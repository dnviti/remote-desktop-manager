import { fireEvent, waitFor } from "@testing-library/dom";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { DbSettings } from "../../api/connections.api";
import ConnectionDialogDatabasePolicyOverrides from "./ConnectionDialogDatabasePolicyOverrides";

function TestHarness() {
  const [dbSettings, setDbSettings] = useState<Partial<DbSettings>>({
    protocol: "postgresql",
  });

  return (
    <>
      <ConnectionDialogDatabasePolicyOverrides
        dbSettings={dbSettings}
        onChange={setDbSettings}
      />
      <pre data-testid="db-settings-state">{JSON.stringify(dbSettings)}</pre>
    </>
  );
}

describe("ConnectionDialogDatabasePolicyOverrides", () => {
  it("stores a connection-scoped firewall rule in dbSettings", async () => {
    render(<TestHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Add Rule" }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Connection firewall preset" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Search presets..."), {
      target: { value: "drop table" },
    });
    fireEvent.click(screen.getByText("Block DROP TABLE"));

    await waitFor(() => {
      expect(
        screen.getByLabelText("Connection firewall rule name"),
      ).toHaveValue("Block DROP TABLE");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Rule" }));

    await waitFor(() => {
      const payload = JSON.parse(
        screen.getByTestId("db-settings-state").textContent ?? "{}",
      );
      expect(payload.firewallRules).toHaveLength(1);
      expect(payload.firewallRules[0]).toEqual(
        expect.objectContaining({
          name: "Block DROP TABLE",
          pattern: "\\bDROP\\s+TABLE\\b",
          action: "BLOCK",
        }),
      );
    });

    expect(
      screen.getByRole("table", { name: "Connection firewall rules" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Block DROP TABLE")).toBeInTheDocument();
  });
});
