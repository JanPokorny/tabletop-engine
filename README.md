# Tabletop Engine

Implementation (a part) of my bechelor's thesis ["A Framework for Modelling Tabletop Game Rules"](https://is.muni.cz/th/bpvm3/). A case-study command-line implementation of the board game Citadels can be [downloaded from the thesis archive](https://is.muni.cz/th/bpvm3/attachments.zip) (I didn't publish it here because copyrights and stuff). 

## What does it do?

This is a library for digitizing tabletop game rules. The game state is represented as a state machine accompanied by a tree-like structure of game tokens. A set of rules written in JS is loaded and executed according to their metadata (preconditions, priority etc.). This allows for game rules expressed in natural language to be (relatively) easily re-written to formal code.

But why would you want to do this, re-write tabletop game rules to a computer code?
- Online board games (checking the rules both client-side and server-side)
    - *Fun fact, this thesis was finished one month before the pandemic started. Playing board games online used to be way more niche back then.*
- Automatic analysis of the game flow when developing rules (dead-end states? impossible situations?)
- AI/Bot development

![image](https://user-images.githubusercontent.com/4580066/125650803-78777c8a-5247-4a76-ae90-66c75b2547a1.png)
*Image: How Tic-Tac-Toe state is represented using a token tree.*

## Example rule

This is a short rule from Citadels, describing how a player draws a card during their turn.

```js
// Choose one card to take
rules.push({
    name: "playerTurnBegin_takeCard",
    stateName: "playerTurnBegin",
    on: "choice",
    pred: (g, move) => move.name == "selectDistrictToTake",
    fn: (g, move) => {
        const board = g.root().findToken("gameBoard");
        const currentPlayerBoard = g
            .root()
            .findToken(
                { name: "playerBoard", owner: g.state.player },
                "!table"
            );

        move.params.district.moveTo(currentPlayerBoard, "districtHand");

        currentPlayerBoard
            .findAllTokens({}, "districtChoiceHand")
            .forEach(t => t.moveTo(board, "districtDeck"));

        return [
            {
                type: "changeState",
                newState: {
                    name: "playerTurnContinue",
                    player: g.state.player,
                    character: g.state.character,
                    districtsBuilt: 0,
                    taxesCollected: false,
                    specialPowerUsed: false
                }
            }
        ];
    }
});
```

## Documenatation

Documentation is contained in the [thesis text](https://is.muni.cz/th/bpvm3/affmtgr_digital.pdf), chapters 4, 5, 6.

## Should I use this?

Frankly, no. This was more of a proof-of-concept, which works sufficiently well, but has some significant drawbacks -- the main one being that no one is actively developing or using this library. Modern online tabletop games are usually developed from the other end anyways -- first the UI is fleshed out with no logic attached, and then optionally (depending on the platform) scripts are added. This is closer to the physical experience, and some studies even show that the "chores" in tabletop games increase the overall enjoyment.

But if you wanted to use something like this, I'd point you at https://boardgame.io/ (https://github.com/boardgameio/boardgame.io), which I discovered only after already submitting my thesis. (Trust me, I did a fair amount of googling beforehand without ever stumbling on a mention of it. 🤷‍♂️)

