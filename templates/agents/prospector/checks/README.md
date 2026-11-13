Machine-checked output checks arrive in slice 3 (SPEC 18). Until then:

- Every lead added names the page it was found on (sourceUrl). A lead without one is stored as unverified and cannot join a campaign; add_lead enforces that in code.
- No email address that is not written on a page the agent read.
- Duplicates (same email or website), suppressed addresses and the lead list's own rules are enforced by add_lead, not by the agent.
