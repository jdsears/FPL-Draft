// Which team news deserves the top of the card.
//
// The list can run long after a full sweep, so it is shown worst first: your
// players before the opponent's before anyone else's, and within a side the
// news that changes who starts before the news that merely colours it.

const KIND_URGENCY = {
  out: 0,
  suspended: 0,
  benched: 1,
  doubt: 2,
  rotation: 3,
  returning: 4,
  starting: 5,
  penalties: 6,
  setpieces: 7,
  form: 8,
  note: 9,
};

export function orderNotes(notes, { mine, theirs } = {}) {
  const side = (note) =>
    mine?.has(note.playerId) ? 0 : theirs?.has(note.playerId) ? 1 : 2;
  const urgency = (note) => KIND_URGENCY[note.kind] ?? 9;
  return (notes || [])
    .slice()
    .sort(
      (a, b) =>
        side(a) - side(b) ||
        urgency(a) - urgency(b) ||
        String(b.at || "").localeCompare(String(a.at || ""))
    );
}

/** Notes recorded for an earlier gameweek than the one being planned. */
export function oldNoteIds(notes, event) {
  return (notes || [])
    .filter((note) => Number(note.event) > 0 && Number(note.event) < Number(event))
    .map((note) => note.id);
}
