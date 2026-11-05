// The policy until SB-06 lands: every action needs a card. It never allows anything on its own,
// so nothing runs unattended.
export function check() {
  return { class: "yellow", needs: "card", reason: "No policy installed yet", blocked: false };
}
