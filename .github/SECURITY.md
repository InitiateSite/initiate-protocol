# Security Policy

## Scope

This repository contains the Initiate website and project documents. No smart contract is published yet, so there is currently nothing on-chain in scope. When contracts are released, this policy will be updated to list their addresses.

In scope today:

- Cross-site scripting or injection through third-party data shown on the site
- Weaknesses in the Content-Security-Policy or other delivery settings
- Any way to make the site display a false contract address, link or status
- Leaks of visitor data

Out of scope:

- Reports about the third-party services the site reads (RPC, DefiLlama, DexScreener); report those to their operators
- Missing hardening on hosting you control, unless it affects visitors
- Social engineering and impersonation accounts (please still tell us, see below)

## Reporting

**Please do not open a public issue.**

Use the repository's private vulnerability reporting (the *Security* tab, then *Report a vulnerability*) once the repository is public. No security email address is published, and none should be trusted unless it is listed here.

Include:

- What you found and where
- Steps to reproduce, or a proof of concept
- The impact as you understand it
- Your preferred name for credit, if any

## What to expect

- Acknowledgement of your report.
- An assessment and a plan, with updates as it progresses.
- Credit in the fix notes if you want it.

No response times are promised here because no team size or schedule has been announced. Good-faith research will not be met with legal action.

## Impersonation

Until a contract address and official accounts appear in the website's Records section, **nothing else is official.** If you see a token, account or site claiming to be Initiate that is not listed there, treat it as a scam and report it to the platform hosting it.

## Safe practice for users

- Verify any address against the site's Records section before interacting.
- Never share a seed phrase or private key with anyone, including people who say they represent Initiate.
- Nothing on the site asks you to connect a wallet or sign anything today. Treat any prompt that claims otherwise as hostile.
