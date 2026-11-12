Machine-checked output checks (repair, then escalation to a stronger model) arrive in slice 3 (SPEC 18).

Until then the limits are written down here, in the first-touch-email skill and in the role text:

- Subject under 8 words. Body under 170 words. One call to action.
- At least two findings marked verified; nothing the agent invented.
- No price that is not written in COMPANY.md; no medical, legal or guaranteed-outcome claim.

What must always hold does not depend on the agent following this. The proposal handler (`propose_email`) and the email executor enforce the claims, price, suppression, do-not-contact, send-cap and kill-switch rules in code.
