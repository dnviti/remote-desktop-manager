import { render } from "@testing-library/react";
import { fireEvent, waitFor } from "@testing-library/dom";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./LoginPage";
import { useAuthStore } from "../store/authStore";
import { useUiPreferencesStore } from "../store/uiPreferencesStore";

const {
  requestPasskeyOptionsApi,
  verifyPasskeyApi,
  loginApi,
  requestEmailCodeApi,
  verifyEmailCodeApi,
  verifyTotpApi,
  requestSmsCodeApi,
  verifySmsApi,
  mfaSetupInitApi,
  mfaSetupVerifyApi,
  requestWebAuthnOptionsApi,
  verifyWebAuthnApi,
} = vi.hoisted(() => ({
  requestPasskeyOptionsApi: vi.fn(),
  verifyPasskeyApi: vi.fn(),
  loginApi: vi.fn(),
  requestEmailCodeApi: vi.fn(),
  verifyEmailCodeApi: vi.fn(),
  verifyTotpApi: vi.fn(),
  requestSmsCodeApi: vi.fn(),
  verifySmsApi: vi.fn(),
  mfaSetupInitApi: vi.fn(),
  mfaSetupVerifyApi: vi.fn(),
  requestWebAuthnOptionsApi: vi.fn(),
  verifyWebAuthnApi: vi.fn(),
}));

const { getOAuthProviders } = vi.hoisted(() => ({
  getOAuthProviders: vi.fn(),
}));

const { resendVerificationEmail } = vi.hoisted(() => ({
  resendVerificationEmail: vi.fn(),
}));

const { switchTenant } = vi.hoisted(() => ({
  switchTenant: vi.fn(),
}));

const { browserSupportsWebAuthn, startAuthentication } = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
}));

vi.mock("../api/auth.api", () => ({
  loginApi,
  requestPasskeyOptionsApi,
  verifyPasskeyApi,
  requestEmailCodeApi,
  verifyEmailCodeApi,
  verifyTotpApi,
  requestSmsCodeApi,
  verifySmsApi,
  mfaSetupInitApi,
  mfaSetupVerifyApi,
  requestWebAuthnOptionsApi,
  verifyWebAuthnApi,
}));

vi.mock("../api/oauth.api", () => ({
  getOAuthProviders,
}));

vi.mock("../api/email.api", () => ({
  resendVerificationEmail,
}));

vi.mock("../api/tenant.api", () => ({
  switchTenant,
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn,
  startAuthentication,
}));

vi.mock("../components/OAuthButtons", () => ({
  default: () => <div data-testid="oauth-buttons" />,
}));

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();

    useAuthStore.setState({
      accessToken: null,
      csrfToken: null,
      user: null,
      isAuthenticated: false,
      permissionsLoaded: false,
      permissionsLoading: false,
      permissionsSubject: null,
    });
    useUiPreferencesStore.setState({
      lastActiveTenantId: "",
    });

    getOAuthProviders.mockResolvedValue({ ldap: false });
    resendVerificationEmail.mockResolvedValue(undefined);
    switchTenant.mockResolvedValue({});
    browserSupportsWebAuthn.mockReturnValue(true);
    requestPasskeyOptionsApi.mockResolvedValue({
      tempToken: "temp-passkey-token",
      options: {
        challenge: "challenge-value",
        rpId: "localhost",
        timeout: 60000,
      },
    });
    startAuthentication.mockRejectedValue(
      new DOMException("cancelled", "NotAllowedError"),
    );
    loginApi.mockResolvedValue({
      accessToken: "access",
      csrfToken: "csrf",
      user: {
        id: "user-1",
        email: "admin@example.com",
        username: null,
        avatarData: null,
      },
      tenantMemberships: [],
    });
    requestEmailCodeApi.mockResolvedValue({ message: "sent" });
    verifyEmailCodeApi.mockResolvedValue({
      accessToken: "access",
      csrfToken: "csrf",
      user: {
        id: "user-1",
        email: "admin@example.com",
        username: null,
        avatarData: null,
      },
    });
    verifyTotpApi.mockResolvedValue({
      accessToken: "access",
      csrfToken: "csrf",
      user: {
        id: "user-1",
        email: "admin@example.com",
        username: null,
        avatarData: null,
      },
    });
    requestSmsCodeApi.mockResolvedValue({ message: "sent" });
    verifySmsApi.mockResolvedValue({
      accessToken: "access",
      csrfToken: "csrf",
      user: {
        id: "user-1",
        email: "admin@example.com",
        username: null,
        avatarData: null,
      },
    });
    mfaSetupInitApi.mockResolvedValue({
      secret: "secret",
      otpauthUri: "otpauth://totp/test",
    });
    mfaSetupVerifyApi.mockResolvedValue({
      accessToken: "access",
      csrfToken: "csrf",
      user: {
        id: "user-1",
        email: "admin@example.com",
        username: null,
        avatarData: null,
      },
    });
    requestWebAuthnOptionsApi.mockResolvedValue({ challenge: "challenge" });
    verifyWebAuthnApi.mockResolvedValue({
      accessToken: "access",
      csrfToken: "csrf",
      user: {
        id: "user-1",
        email: "admin@example.com",
        username: null,
        avatarData: null,
      },
    });
    verifyPasskeyApi.mockResolvedValue({
      accessToken: "access",
      csrfToken: "csrf",
      user: {
        id: "user-1",
        email: "admin@example.com",
        username: null,
        avatarData: null,
      },
      tenantMemberships: [],
    });
  });

  it("starts in passkey-first mode and falls back after three failed attempts", async () => {
    const view = renderLoginPage();

    expect(
      await view.findByText(
        "Use a passkey to sign in without entering your email and password first.",
      ),
    ).toBeInTheDocument();

    await view.findByText("Failed attempts this visit: 1/3");

    fireEvent.click(view.getByRole("button", { name: "Retry Passkey" }));
    await view.findByText("Failed attempts this visit: 2/3");

    fireEvent.click(view.getByRole("button", { name: "Retry Passkey" }));

    expect(
      await view.findByRole("button", { name: "Try passkey instead" }),
    ).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
    expect(view.getByText("Forgot password?")).toBeInTheDocument();
    expect(requestPasskeyOptionsApi).toHaveBeenCalledTimes(3);
  });

  it("reveals password fallback immediately when the user chooses it", async () => {
    const view = renderLoginPage();

    await view.findByText(
      "Use a passkey to sign in without entering your email and password first.",
    );

    fireEvent.click(
      view.getByRole("button", { name: "Use email and password instead" }),
    );

    expect(
      await view.findByRole("button", { name: "Try passkey instead" }),
    ).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Sign In" })).toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: "Try passkey instead" }));

    expect(
      await view.findByText(
        "Use a passkey to sign in without entering your email and password first.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(requestPasskeyOptionsApi).toHaveBeenCalledTimes(2);
    });
  });
});
