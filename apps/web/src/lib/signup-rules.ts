/** Self-host sign-up: the first account may sign up, then people join by invitation unless the operator opens it. */
export function selfhostSignupOpen(o: { users: number; openSignup: boolean }) {
  return o.users === 0 || o.openSignup;
}
