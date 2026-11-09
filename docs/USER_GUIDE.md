# Using ChessAsh

Download the Windows installer or Android APK from [Releases](https://github.com/FlameFirelife/ChessAsh/releases/latest). Windows downloads are unsigned. Android needs a recent System WebView with WebAssembly support. Keep the same Android app signing identity when installing updates.

## Import a game

Choose **Import game**, select Chess.com or Lichess, then enter a username. Lichess also accepts a single game link without a username. You can open or paste a PGN too. For your own account, choose **This is my account. Keep it synced.** ChessAsh checks for recent finished games while the app is active and online. Other imported players have separate Library collections.

The included sample lets you try a review without importing your own game. Samples do not become personal training exercises.

## Review the turning points

Choose your side under **Review as**, then start a review. Stockfish runs on your device. Completed reviews and notes stay in your local library and can be opened offline. **Reanalyse** starts a new engine review; **Continue review** resumes a paused review.

Use the arrows or move list to step through the game. The coach explains the move above the board. The blue best-move summary names the piece, its source and destination, and a short benefit when the position supports one. Open **Full explanation** for the complete reasoning and analysed continuation. Select a linked square to highlight it on the board.

**Try again** lets you choose another move. Moves you try receive a temporary review; your original game and notes stay saved. **Show line** previews the engine continuation. Open **Explore** when you want to explore manually.

Mobile review uses a compact navigation bar, with Settings and Import available beside the main navigation. The welcome screen, Library and Training show the full header. The explanation area scrolls internally; very short screens can also scroll the page.

## Practice your mistakes

Finish a review from your own side, then open **Training**. Start a mixed session or choose a specific pattern. Failed attempts can show a playable opponent reply and explain the underlying problem. After solving or revealing a solution, compare it with the original move.

Practice results shape what returns next. Unfinished sessions resume, and the recap separates independent solves, retries and revealed solutions. See the [training guide](../TRAINING_GUIDE.md) for the full workflow.

## Adjust the experience

Settings include English/Italian, appearance, text size, reduced motion and move sounds. **Move-quality names** chooses ChessAsh or Chess.com terminology, such as Sound sacrifice or Brilliant. Enable **Move sounds** for the soft wooden tap. The advantage graph, detailed notation and advanced analysis controls are optional.

## Use the optional tutor

On Windows, open **Tutor** and choose Ollama or your API provider. Basic review and Training run without a model or API key. API tutoring sends the current position, engine findings and recent chat to the provider you choose; provider charges may apply.

Tutor replies support formatted text and legal line previews. Explanations can still be wrong. Engine depth and available continuations limit what ChessAsh can establish about a position; an analysed line does not mean every move is forced.

For build instructions and platform requirements, see [BUILDING.md](../BUILDING.md) and [PLATFORMS.md](../PLATFORMS.md). Sources and licences are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Share a review card

Select Share review beside the PGN export button. Choose a moment and whether to show player names. Every card includes the ChessAsh repository URL. Share opens Android’s sharing menu; Save PNG image saves a separate copy. Browsers with file sharing support can share directly too.
