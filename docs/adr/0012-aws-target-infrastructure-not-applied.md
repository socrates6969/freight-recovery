# ADR 0012: AWS target infrastructure as Terraform, validated but never applied

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-08 (`b939225` "Terraform skeleton (infra/)"), extended `fb1926d`, `c5d780b`, `b603b14`,
  `8ac4360`
- **Reconstructed from:** `infra/*.tf`, `infra/README.md`, `deploy/aws.md`, `ARCHITECTURE.md` "AWS mapping (web
  stack)", `CLAUDE.md` layout table

## Context

Buyers ask where their data would live and how it would be protected before they look at features. The project
has no customers and no budget for a running environment, but it needs a concrete, reviewable deployment design
so that security claims in documents refer to something real.

## Decision

- The web stack targets AWS: CloudFront with a response-headers policy generated from the same JSON the local
  nginx uses, S3 for the SPA with origin access control, an ALB reachable only from CloudFront with an
  origin-verify header, WAFv2, ECS Fargate in private subnets with VPC endpoints and no NAT, RDS PostgreSQL 16 with
  forced TLS and KMS, ElastiCache Redis 7 with TLS and at-rest encryption, an S3 documents bucket that denies puts
  without the customer-managed key, and seven Secrets Manager containers whose values are set out of band.
- Migrations run as a one-off ECS task before rollout. Secret values never enter Terraform state.
- Nothing is applied automatically. CI runs `terraform fmt -check` and `validate` only.

## Consequences

- Every infrastructure statement in our documents is "designed in IaC, unverified in AWS". We must keep saying
  that until a real environment exists and has been tested.
- Running costs, failover behaviour and latency are unknown; none has been measured.
- A first deployment will surface issues that `validate` cannot catch (quotas, certificate validation, WAF rule
  tuning). The hardening run already added preconditions for some of these (H-2, H-3).
