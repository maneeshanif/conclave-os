The scout's result is checked to be non-empty (`output_check: non-empty`); a scout that finishes with nothing is repaired once, then tried on Claude once, then its task is blocked for a person.

What must always hold does not depend on the agent following this:

- Every signal has a web address (http or https), a kind, and a source; `add_signal` refuses anything else.
- The same address is one signal, however it is written.
- A signal can only be scored by a scout; promoting or dismissing one is a person's decision, and there is no tool for it.
- Text that reads like instructions is kept as text and flagged; it changes nothing.
