const OPENINGS: Array<[string, string]> = [
  ['e4', 'King’s Pawn'], ['d4', 'Queen’s Pawn'], ['c4', 'English Opening'], ['Nf3', 'Réti Opening'],
  ['e4 e5', 'Open Game'], ['e4 c5', 'Sicilian Defence'], ['e4 e6', 'French Defence'], ['e4 c6', 'Caro–Kann Defence'],
  ['e4 d5', 'Scandinavian Defence'], ['e4 d6', 'Pirc setup'], ['e4 Nf6', 'Alekhine Defence'],
  ['d4 d5', 'Closed Game'], ['d4 Nf6', 'Indian Game'], ['d4 f5', 'Dutch Defence'],
  ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'], ['e4 e5 Nf3 Nc6 Bb5', 'Ruy López'],
  ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'], ['e4 e5 Nf3 Nf6', 'Petrov Defence'],
  ['e4 e5 Nc3', 'Vienna Game'], ['e4 e5 f4', 'King’s Gambit'],
  ['d4 d5 c4', 'Queen’s Gambit'], ['d4 d5 c4 e6', 'Queen’s Gambit Declined'],
  ['d4 d5 c4 dxc4', 'Queen’s Gambit Accepted'], ['d4 d5 c4 c6', 'Slav Defence'],
  ['d4 Nf6 c4 g6', 'King’s Indian setup'], ['d4 Nf6 c4 e6 Nc3 Bb4', 'Nimzo-Indian Defence'],
  ['d4 d5 Bf4', 'London System'], ['d4 Nf6 Bf4', 'London System'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'Sicilian Najdorf'],
  ['e4 e6 d4 d5', 'French Defence'], ['e4 c6 d4 d5', 'Caro–Kann Defence'],
];

export function openingName(moves: string[]): string {
  let result = 'Unclassified opening';
  let length = 0;
  for (const [sequence, name] of OPENINGS) {
    const prefix = sequence.split(' ');
    if (prefix.length > length && prefix.every((move, index) => move === moves[index])) {
      result = name;
      length = prefix.length;
    }
  }
  return result;
}

export function isBookMove(moves: string[], ply: number): boolean {
  return ply > 0 && OPENINGS.some(([sequence]) => {
    const prefix = sequence.split(' ');
    return ply <= prefix.length && prefix.slice(0, ply).every((move, index) => move === moves[index]);
  });
}
