---
name: score-signal
description: "Use after you record a signal. Give it a whole-number score from 0 to 100 and a one-sentence reason. 60 or more puts it in the morning list for a person."
---

# Score a signal

You score each signal you recorded, so a person sees the best ones first.

1. **Read it again** (the excerpt you recorded). Judge only what is written there.
2. **Pick a whole number from 0 to 100.**
   - 80 to 100: a clear, specific request or problem that matches what the company does, with something recent or urgent in it.
   - 60 to 79: a real request or problem that fits, but with little detail.
   - 30 to 59: might fit, vague, or only partly ours.
   - 0 to 29: probably not for us.
3. **Write the reason in one sentence** that points at something in the excerpt ("asks for a booking page rebuild and says the budget is fine"). Not a feeling, not a guess about the person.
4. **Call score_signal** with the signal id, the score and the reason. A score of 60 or more marks the signal qualified. You cannot promote, dismiss or contact anyone; a person decides what happens next.
5. A new score replaces the old one. Do not score a signal twice in one run.
