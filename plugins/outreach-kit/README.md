# outreach-kit

What an outreach rep needs to write a first email and nothing more.

- **Skill `first-touch-email`:** the procedure, from reading the lead to proposing the email.
- **Connector `os`:** the only connector. The tools it uses are `get_lead` and `propose_email`.

It carries no way to send. `propose_email` queues one email for a person to approve; the email executor sends it after approval, and the checks that matter (medical, legal and price claims, the suppression list, do-not-contact, the send caps, the kill switch) run in the server, not in this skill.

`propose_email` is offered only to an agent at autonomy 2 or higher (SPEC 6). A new outreach rep starts at 0, on trial, and writes its drafts as comments until it is promoted.

Skills here are in the open Agent Skills format, so Claude Code and OpenCode both load them.
