> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen. Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Utrullingsvei på AWS (kun design - ingenting er provisjonert)

> Status: **skisse**. Dette repoet gjør ingen AWS-kall, lagrer ingen legitimasjon, og
> Terraform i `deploy/terraform/` har aldri blitt anvendt. MVP-en har ingen autentisering og ingen
> persistens, så ikke legg den ut på det åpne internett før TODO-ene nedenfor er gjort.

## Målbilde

```
Internet -> ALB (HTTPS, ACM cert) -> ECS Fargate service (freight-recovery container)
                                         |-> RDS PostgreSQL (private subnets)   [future: persistence]
                                         |-> S3 bucket for uploaded documents   [future]
                                         |-> Secrets Manager (DB creds, LLM key) [future]
                                         '-> CloudWatch Logs
```

- **Databehandling:** ECS på Fargate, 1 task (0,5 vCPU / 1 GB) til å begynne med; appen er tilstandsløs i dag.
- **Image:** bygges fra `Dockerfile`, pushes til ECR (`aws ecr` / CI-steg).
- **Database (fremtidig):** RDS PostgreSQL i private subnett, med en security group som kun tillater
  tjenestens SG. MVP-en bruker ikke DB ennå - legg til SQLAlchemy/Alembic når persistens kommer.
- **Dokumenter (fremtidig):** S3 med SSE-KMS, privat, livssyklusregler; lagre sha256 (allerede
  beregnet ved innlesing) sammen med objektet for bevisintegritet.
- **Nettverk:** ALB i offentlige subnett, tasks og RDS i private subnett, NAT eller VPC-endepunkter.
- **Observerbarhet:** CloudWatch Logs + `/health` som helsesjekk for target group.

## Vei til første utrulling (sjekkliste, ikke gjort)

1. Opprett ECR-repo, push image.
2. Anvend Terraform-skjelettet (VPC, ALB, ECS-klynge/tjeneste, task-rolle, loggruppe, valgfri RDS).
3. Sett autentisering foran (Cognito/OIDC på ALB eller i appen) - **påkrevd før reelle data**.
4. Erstatt stub-uttrekksleverandøren med en reell; lagre leverandørnøkkelen i Secrets Manager.
5. Legg til opplastingsgrenser, malware-skanning, isolasjon per tenant, revisjonslogging.
6. Gå gjennom datahåndtering (fraktdokumenter inneholder kommersielle vilkår; kan være kontraktsmessig konfidensielle).

## Terraform-skisse

Se `deploy/terraform/main.tf`. Det er et **skjelett** med variabler og hovedressursene
stubbet som kommentarer/minimale blokker; kjør `terraform validate` først etter at nettverks-
inndata er fylt ut. Fjerntilstand (S3 + DynamoDB-lås) er bevisst ikke konfigurert.

## Utenfor omfang / TODO

- Multi-AZ, autoskaleringspolicyer, WAF, sikkerhetskopier/PITR, DR, kostnadskontroll.
- CI/CD mot ECR/ECS (GitHub OIDC-rolle) - `.github/workflows/ci.yml` kjører bare tester/bygg.
- SOC 2 / compliance-arbeid.
