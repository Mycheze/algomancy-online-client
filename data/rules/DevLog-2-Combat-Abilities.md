Today I’m going to be looking at an outstanding problem that needed resolution with the Algomancy combat system and a solution that I’m fairly excited about.

First, I’ll give a brief refresher into how the Algomancy combat system works. (There is also a more thorough explanation available [here](https://calebgannon.com/2022/07/06/the-rules-of-algomancy/). ) When creatures enter into combat (either attacking or defending), their controller assigns them into a formation by selecting their positions relative to each other. This formation remains fixed throughout the duration of the combat step, and determines the geometry of how combat unfolds. You can see a diagram of this below.

In the formations, I allow for a front and back row. Creatures can only be placed in the back row if they are behind something in the front row. When a pair of creatures occupying the front and back row get into combat, they fight together. This means they deal damage equal to their combined attack to whatever is in front of them. Then they receive damage in order from front to back. So the creature in front dies first, then excess damage beyond the health of the front row creature is dealt to the back row creature.

This all works out fairly well with plain creatures who just have stats, but it was poorly defined for situations where one or both of the creatures had combat abilities. Combat abilities are modifiers that affect how the creatures engage in combat, such as the three abilities below.

For example, if you have Piranha of the Woods in the back row and a 2/2 creature in the front row against a plain 3/3 in the front and a 2/2 in the back, how should combat unfold?

## One Solution

The first thought I had was to define a damage ordering, making the front row creatures deal damage first and then the back row creatures. In that instance, you would first deal 2 damage to the 3/3, followed by 1 deadly damage. If the positions of the creatures were switched, meaning Piranha of the woods is in the front and your 2/2 is in the back, you would first deal 1 deadly damage and kill the 3/3 creature. Then your back row 2/2 would kill the opposing 2/2. Which is probably the intended outcome.

Ok so our solution works for a deadly creature, but lets get slightly more complicated and talk about Smoke Ghost, which has flying. How should my opponent be able to block when Smoke Ghost is in the front or back row?

The intuitive answer for me is that when Smoke Ghost is in front, the opponent should not be able to block without flying but when it is in the back they should be able to block. The problem with this is that it essentially gives flying an additional, unintended consequence by letting flying creatures carry other creatures into combat and grant them flying as well. It also adds a bit more confusion when learning, since flying creatures placed in the back row will not perform as written (your opponent will be able to block it with a non-flying creature).

We can examine another ability: Overwhelming. Overwhelming says “Excess damage dealt by an attacking overwhelming creature is dealt to the defending player.” How should this interact with combat damage when in the front or back?

We can use the “two damage steps” idea from before when working with deadly creatures if we want. If the Overwhelming creature deals damage first, the excess damage is unlikely to hit the player behind. But if we place our overwhelming creature in the back row then it deals damage after the one before it has hit and is more likely to hit the defending player.

## Problems with this strategy

All of the above discussions and ideas about the problem of combat abilities technically work, but they add a lot of complexity to the game.

For example, two damage steps is confusing. Do you get priority between them? What if the back row creature is dealt lethal damage before it has chance to attack? It also makes combat substantially harder to plan out, especially if there is priority given for spells or abilities between the two steps.

This approach may also hurt player understanding and experience. It doesn’t make sense that a flying creature should be able to be blocked just because it was put in the wrong spot. If feels bad to have an overwhelming creature get into a combat situation where more than lethal damage can be dealt to the creature in front of it without that damage overflowing to the opponent.

Basically, the above approach feels like a “band-aid” fix to the problem. I can technically make it work, but it detracts from the game, rather than adding to it.

## A different approach

Instead of doing all the above stuff, I just decided that combat abilities will be shared between front and back row creatures. The flavor here is that the two creatures are partners who work together, so why not let them combine abilities as well? Couldn’t a poisonous mushroom share its poison with its spiky partner? Couldn’t a bird pick up its partner and allow them to fly together?

The first advantage of this approach is that all the abilities work how the player would want them to without the need of adding complications like two damage steps. Have a big Overwhelming monster? Your damage will overflow whether the monster is in the front or back row. Deadly creatures will get their chance to one shot opposing creatures (unlike in the example above, where it would be possible for a deadly creature to deal the final damage to an opposing creature, which feels bad). Flying works whether the flier is in the front or back row… etc

### Ability Combos

The other cool benefit of this is that it adds an entirely new aspect to the game: ability combos. While both of the above cards were cool on their own, when you combine them together in this new ruleset they become something incredible. Instantly kill the three creatures in front of them? Sign me up!

The appeal of this is that I can add deep complexity and “combo potential” to the game now without adding extensive amounts of text to the cards. In fact, I can remove some!

Below are two designs I had made for the same card. The first was created before I had settled on this approach for handling abilities. The extra line of text was explicitly added to enable combos such as the one mentioned above. With the new rules system, I don’t need any other abilities to make this card do awesome things. Now the card is easier to read (you can understand exactly what it does just by looking at the title section of the card), simpler to play with and yet the combo potential is actually higher!

Yes, this approach appears to make the card design aspect of the game more complicated. Now every single combat ability has to be evaluated for its potential for game breaking combos. However, because this design choice inherently create a deep gameplay experience just by allowing for many different ability combinations, it may actually be easier for me in the long run,

Instead of designing explicitly worded cards with complicated single use abilities, I can focus my design efforts on creating keyworded abilities that will be used on multiple cards, and the interactions these abilities create.

For example, through this process I came up with the idea to have an ability that draws damage in towards the creature. The below example is just a quick mockup of what an ability like this may look like. On its own, this card is really cool. You can send it into combat to protect its allies, making it a great offensive threat while on defense it can block up to three creatures by itself. There is obviously some balancing that needs to happen here, but the depth to this card with a single keyword ability is surprisingly great.

Outside of its standard applications, with the new rules you could place a defending creature behind something that likes to get hit, such as one of the following two and really soak up the value.

And this is just one application of one ability I had while writing this article! I think for balancing I will probably have to make something like a “right defender” and “left defender” (or somehow have a single ability that chooses one side) since stealing all the damage from three creature is quite a lot.

Anyway, that is all for the article for today. If you have any ideas for cool combat abilities with some fun combo potential, let me know in the comments! I think the idea today will significantly reshape how the game is designed, leading to cards with less text and hopefully deeper gameplay. I just want to maximize the feeling of “ooh that would be fun with what I have” during the drafting stage, and having the potential to combine abilities into combos does just that!

I’ll be on the lookout for other opportunities for things like this in the future. Now I want to somehow do this with spells….
