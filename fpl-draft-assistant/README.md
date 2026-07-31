# FPL Draft Assistant

A draft-day companion for the official Fantasy Premier League Draft game
(draft.premierleague.com), built for a 10-team league. It gives you a ranked
player board, a live pick tracker, best-available suggestions, and Nova, an AI
strategist you can chat with during the draft.

## What it does

- **Draft board**: every player ranked by value over replacement (VORP), with
  projected points, last season's totals, and injury news. Filter by position,
  search by name or club.
- **Live sync**: connect your league ID and the board updates automatically as
  picks are made in your official draft. Manual "Mine"/"Gone" buttons work as a
  backup if you prefer.
- **Best available**: the top remaining players in each position, with your
  squad slots (2 GKP, 5 DEF, 5 MID, 3 FWD) tracked against limits.
- **My team**: your roster as it builds, saved in your browser between visits.
- **Nova (AI assistant)**: chat about who to pick next. She sees your roster,
  the best available players, and recent picks by rivals.

## Deploy on Railway (about 10 minutes)

1. **Put the code on GitHub.** Create a free account at github.com if you do
   not have one. Click the plus icon, "New repository", name it
   `fpl-draft-assistant`, keep it Private, and create it. Then click
   "uploading an existing file" and drag in everything from this folder
   (not the folder itself, its contents). Commit the upload.
2. **Create the Railway project.** In railway.app, choose "New Project", then
   "Deploy from GitHub repo", and pick `fpl-draft-assistant`. Railway detects
   Node, installs, builds the interface, and starts the server on its own.
3. **Add your API key.** In the Railway service, open Variables and add:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com (needed for the
     AI chat; everything else works without it)
   - `ANTHROPIC_MODEL` = optional, defaults to `claude-sonnet-4-5`
4. **Get your link.** In Settings, under Networking, click "Generate Domain".
   Open that URL on your laptop or phone. That is your app.

Chat usage is pay-as-you-go on your Anthropic key; a busy draft evening of
questions typically costs pennies rather than pounds.

## Using it on draft day

1. Open the **League** tab and enter your league ID. It is the number in the
   web address when you view your league, e.g.
   `draft.premierleague.com/league/12345/status`.
2. Tap your own team name so the app knows which picks are yours.
3. Keep the **Draft board** or **Best available** tab open during the draft.
   Picks sync every 10 seconds. Anything the sync misses you can mark by hand.
4. Ask **Nova** whenever you are on the clock and unsure.

## Notes

- If the FPL API is unreachable, the app shows a small built-in demo dataset
  and a "Demo data" badge so you always see a working interface. On Railway
  you should see the "Live FPL data" badge.
- Rankings before the first gameweek are based on last season's points with a
  points-per-game adjustment, translated into value over replacement for a
  10-team draft. Once the season starts, live FPL data flows through the same
  board.
- Your roster and league ID are stored only in your own browser.

## Run locally (optional)

```
npm install
npm run build
npm start
```

Then open http://localhost:3000.
