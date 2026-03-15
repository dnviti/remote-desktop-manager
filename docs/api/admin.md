# Admin Endpoints

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## Tenants

All endpoints require authentication.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/tenants` | User | Create a new tenant |
| `GET` | `/api/tenants/mine/all` | User | List all tenant memberships |
| `GET` | `/api/tenants/mine` | Tenant | Get current tenant details |
| `PUT` | `/api/tenants/:id` | Admin | Update tenant (name, MFA policy, session timeout) |
| `DELETE` | `/api/tenants/:id` | Owner | Delete tenant |
| `GET` | `/api/tenants/:id/mfa-stats` | Admin | Get MFA compliance stats |
| `GET` | `/api/tenants/:id/users` | Tenant | List tenant users |
| `GET` | `/api/tenants/:id/users/:userId/profile` | Tenant | Get user profile details |
| `POST` | `/api/tenants/:id/invite` | Admin | Invite user by email |
| `POST` | `/api/tenants/:id/users` | Admin | Create a new user in tenant |
| `PUT` | `/api/tenants/:id/users/:userId` | Admin | Update user role |
| `DELETE` | `/api/tenants/:id/users/:userId` | Admin | Remove user from tenant |
| `PATCH` | `/api/tenants/:id/users/:userId/enabled` | Admin | Enable/disable user account |
| `PATCH` | `/api/tenants/:id/users/:userId/expiry` | Admin | Update membership expiry date |
| `PUT` | `/api/tenants/:id/users/:userId/email` | Admin | Admin change user email |
| `PUT` | `/api/tenants/:id/users/:userId/password` | Admin | Admin change user password |
| `GET` | `/api/tenants/:id/ip-allowlist` | Admin | Get tenant IP allowlist |
| `PUT` | `/api/tenants/:id/ip-allowlist` | Admin | Update tenant IP allowlist |

<!-- manual-start -->
<!-- manual-end -->

## Teams

All endpoints require authentication and tenant membership.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/teams` | Tenant | Create a team |
| `GET` | `/api/teams` | Tenant | List teams |
| `GET` | `/api/teams/:id` | Team Member | Get team details |
| `PUT` | `/api/teams/:id` | Team Admin | Update team |
| `DELETE` | `/api/teams/:id` | Team Admin | Delete team |
| `GET` | `/api/teams/:id/members` | Team Member | List members |
| `POST` | `/api/teams/:id/members` | Team Admin | Add member |
| `PUT` | `/api/teams/:id/members/:userId` | Team Admin | Update member role |
| `DELETE` | `/api/teams/:id/members/:userId` | Team Admin | Remove member |
| `PATCH` | `/api/teams/:id/members/:userId/expiry` | Team Admin | Update member expiry |

<!-- manual-start -->
<!-- manual-end -->

## Admin

All endpoints require authentication with Admin tenant role.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/email/status` | Get email provider configuration status |
| `POST` | `/api/admin/email/test` | Send test email |
| `GET` | `/api/admin/app-config` | Get app configuration (self-signup, etc.) |
| `PUT` | `/api/admin/app-config/self-signup` | Toggle self-signup |

<!-- manual-start -->
<!-- manual-end -->

## Gateways

All endpoints require authentication and tenant membership. Most require Operator role.

### Gateway CRUD

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/gateways` | Tenant | List gateways |
| `POST` | `/api/gateways` | Operator | Create gateway |
| `PUT` | `/api/gateways/:id` | Operator | Update gateway |
| `DELETE` | `/api/gateways/:id` | Operator | Delete gateway |
| `POST` | `/api/gateways/:id/test` | Tenant | Test gateway connectivity |

### SSH Key Pair Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/gateways/ssh-keypair` | Generate SSH key pair |
| `GET` | `/api/gateways/ssh-keypair` | Get public key |
| `GET` | `/api/gateways/ssh-keypair/private` | Download private key |
| `POST` | `/api/gateways/ssh-keypair/rotate` | Rotate key pair |
| `PATCH` | `/api/gateways/ssh-keypair/rotation` | Update rotation policy |
| `GET` | `/api/gateways/ssh-keypair/rotation` | Get rotation status |
| `POST` | `/api/gateways/:id/push-key` | Push public key to gateway |

### Gateway Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gateways/templates` | List templates |
| `POST` | `/api/gateways/templates` | Create template |
| `PUT` | `/api/gateways/templates/:templateId` | Update template |
| `DELETE` | `/api/gateways/templates/:templateId` | Delete template |
| `POST` | `/api/gateways/templates/:templateId/deploy` | Deploy gateway from template |

### Managed Gateway Lifecycle

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/gateways/:id/deploy` | Deploy managed gateway containers |
| `DELETE` | `/api/gateways/:id/deploy` | Undeploy managed gateway |
| `POST` | `/api/gateways/:id/scale` | Scale gateway replicas |
| `GET` | `/api/gateways/:id/instances` | List container instances |
| `POST` | `/api/gateways/:id/instances/:instanceId/restart` | Restart an instance |
| `GET` | `/api/gateways/:id/instances/:instanceId/logs` | Get instance logs |

### Auto-Scaling

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gateways/:id/scaling` | Get scaling status |
| `PUT` | `/api/gateways/:id/scaling` | Update scaling config |

<!-- manual-start -->
<!-- manual-end -->
