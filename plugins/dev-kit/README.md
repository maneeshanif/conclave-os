# dev-kit

Skills for the Engineering and Product rooms.

- **coding-rules** is how a coder changes a project: read first, test first, smallest change, commit on the task's branch, and what never to touch.
- **motion-gsap-lenis** is how the Frontend Studio adds motion to a page with GSAP and Lenis, and keeps it accessible.

The plugin has no tool of its own. A coder proposes a pull request with `propose_pr` (added to the `os` tools in S7-5), and the server runs the project's tests in the worktree first and refuses the proposal if they fail. Pushing, merging and deploying are approvals; nothing in this plugin can do them.
