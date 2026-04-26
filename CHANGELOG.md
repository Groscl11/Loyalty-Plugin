# Changelog

All notable changes to the Loyalty Plugin are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Security
- Add Shopify webhook HMAC signature verification
- Add admin secret auth to `adjust-loyalty-points` and `update-merchant-config`
- Restrict CORS from wildcard `*` to allowed origins
- Remove all diagnostic `console.log` statements with PII data
- Force `get-loyalty-status` to POST only (removes email from GET query params)

---

## [1.0.0] - 2026-04-23

### Added
- Loyalty widget v6 (React, esbuild bundled) embedded via Shopify Theme Extension
- Referral widget — post-purchase referral rewards on thank-you page
- Order rewards — points earned display on order status and customer account pages
- Points earned — post-purchase points display on thank-you page
- 20 Supabase edge functions: member registration, loyalty status, rewards catalog,
  redemption, webhook processing, profile management, analytics
- Tier system with configurable earn rates and thresholds
- Referral program with configurable reward triggers
- Survey and social action reward flows
- Widget analytics event tracking
- GoKwik integration for customer login detection
- Multi-source customer email detection (Shopify session, localStorage, meta tags)
- Points redemption with Shopify discount code generation

### Infrastructure
- npm workspaces for Shopify UI extensions
- esbuild widget bundle pipeline
- Supabase Edge Functions (Deno runtime)
- Shopify webhooks: `orders/create`, `orders/paid`

---

## Release Guide

### Version bumps
| Change type | Version bump | Example |
|---|---|---|
| Bug fix, no behavior change | Patch `x.x.+1` | `1.0.0` → `1.0.1` |
| New feature, backward compatible | Minor `x.+1.0` | `1.0.1` → `1.1.0` |
| Breaking change or DB migration | Major `+1.0.0` | `1.1.0` → `2.0.0` |

### How to ship a release
```bash
# 1. Merge develop → main via PR
# 2. Tag the release
git tag v1.0.1
git push origin v1.0.1
# → GitHub Actions deploys plugin + edge functions automatically

# 3. Create a GitHub Release from the tag (adds release notes)
```
