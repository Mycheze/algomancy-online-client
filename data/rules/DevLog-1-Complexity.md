I know this is a weird place to start, but I am currently working on this section of the game and wanted to get my thoughts down here first. I’ll go back and write the Dev Log 0 explaining a lot more about the game’s early development later.

These dev logs are mostly going to be written as notes for me to reference in the future, but I figured why not make them public so people can see what’s happening with the game!

The topic I’m investigating today is the question of how much of an impact do my design choices have on the complexity of the game? For quantitative reasoning, I’ll use the total size of the decision tree to represent the complexity of a game state. More possible choices = more complicated.

A bit of background: The combat system in Algomancy is structured around an adjacency mechanic that, rather than being defined by placing the cards in an objective position in space (like some global grid), is defined by the relative positioning of the cards. For example, when I attack with a group of creatures I place them in a relative positioning to each other. This relative positioning defines how the defending team can block my attacking team, as shown in the diagram below.

The “back row” creatures are also adjacent to the creatures in front of them and to the side. They deal combat damage in a “stack”, meaning the total sum of the two creature’s (front and back row) power is dealt to the opposing creatures in order, front to back. Then the opposing creatures deal the sum total of their power to the two other creatures in order from front to back.

## Complexity

Anyway, I’m investigating the topic of complexity because I originally thought that limiting the interactions of creature abilities to adjacent cards would decrease the complexity of the game. “The card ability is affecting less cards, so clearly that is less complexity…. right?”.

Well after some playtesting I appeared to be quite wrong. The “adjacency matters” cards, like the ones below ended up being substantially more complicated than any other cards in the game. While their effects were easy to determine once things were decided upon, planning out strategies with them could often get quite complex.

When only a few were in play at the same time, there was not so much of a problem. You generally want to surround these adjacency matters cards to maximize their benefits. But problems started to show up in situations where many of these cards were in play at once and the ability to maximize each cards effects were not so obvious.

If each cards effect was simply “all creatures gain X”, then the question of “how do I set up my squad to attack optimally” would be independent of the abilities on the cards, since each battle configuration would be equal in terms of the benefits you get from the abilities. But now, you have many different things pulling you in a lot of directions. You want the fish to be in the center to give +2/+2 to as many adjacent creatures as possible, but you also want the devastating spike in the center to hit as many defending creatures as you can.

This gets even more complicated with cards like “slime cannon”, which need adjacent creatures to be unimportant so you can sacrifice them but the card slime cannon itself has no attack so you don’t really want to run it at the center of your formation.

## Quantitative Analysis

My first thought when experiencing this issue was something like “Well I’m just not used to this system, that’s why it feels more difficult to navigate than combat in most other card games”. Fortunately my curiosity got the better of me and I decided to figure out the truth. Just how complex is this combat system over a more traditional method like combat in the trading card game Magic the Gathering (MTG)?

In MTG there is absolutely no adjacency grid, you simply decide which you want to attack with and that is all. If you have n creatures in play, then you can attack with up to n creatures. If you have 4 creatures and decide to attack with 4 creatures, there is only 1 possible way to do that. If you have 4 creatures and decide to attack with 3 creatures, there are 4 ways to do that (you can re-think the problem of which 3 creatures do I attack with as which 1 creature do I not attack with, and it becomes a lot easier to imagine).

If we wanted to write this out formally, the problem of “I have n creatures, how many different ways can I attack” can be broken down into two steps. First, we need to decide how many creatures we would like to attack with. Once we choose that, we can calculate how many different ways there are to attack with the chosen number of creatures. If we add up all the configurations from attacking with 0 creatures to attacking with every creature, we can get the total number of possible actions we can take.

Fortunately, there is a convenient mathematical function to describe the situation where we have n items and we want to select k from them, which is known as a combination. The term on the left is read as “n choose k”. In our example, we were looking at 4 choose 3, which we would expect to be equal to 4. Looking at the equation, we have 4 factorial over 3 factorial, which does in fact equal 4.

\$\${n\choose k} = \frac{n!}{k!(n-k)!}\$\$

Now we just need to wrap this function into a summation, to account for all of the possible number of creatures we could attack with.

\$\$\sum\_{k=0}^{k=n}{n\choose k} = 1 + 4 + 6 + 4 + 1 = 16 \$\$

Interestingly, this formula can be greatly simplified to just \\2^n\\, since we are summing over a single row of binomial coefficients. [Link to a proof](https://proofwiki.org/wiki/Sum_of_Binomial_Coefficients_over_Lower_Index).

\$\$\sum\_{k=0}^{k=4}{4\choose k} = 2^4 = 16 \$\$

Now we have a function that defines how the complexity of our game decision scales with the number of cards in play in a standard game without any adjacency matters. Let’s investigate how the adjacency matters stuff complicates things.

For this initial question I am going to ignore the back-row and simply look at the problem of attacking with a single line of creatures where their relative ordering matters.

As before, we have the case where we can attack with any number of creatures from 0 to n, so we know there is going to be a summation over these terms involved. The difference here is that rather than working with a combination where order does not matter, we are now interested in a permutation of terms where their ordering is important.

Fortunately, the permutation of n objects is defined to be \\n!\\, which makes our math simple enough. We can then break our problem of “how many ways are there to attack with n creatures when order matters” in terms of what we solved before, but now we get to include the number of different ways you could arrange the chosen creatures. We can add this by just multiplying the equation above by \\k!\\, since we are choosing k creatures, we need to incorporate the number of ways to arrange those k creatures into our formula.

\$\$\frac{n!}{k!(n-k)!}\*k! = \frac{n!}{(n-k)!}\$\$

Then we need to evaluate this function and add up all the values for all the possible different number of creatures we could attack with.

\$\$\sum\_{k=0}^{k=4}\frac{4!}{(4-k)!} = 1 + 4 + 12 + 24 + 24 = 65 \$\$

With 4 creatures in play, we can already see that the complexity of the adjacency matters situation is roughly four times larger than the basic case, and things get worse very quickly for larger values of n. Below is a plot I made of the two cases.

And here is the situation when I zoom out just a little bit more.

Basically, once we get beyond 6 cards in play, the adjacency matters stuff goes absolutely crazy in terms of complexity. In designing the game I absolutely would not have guessed there would be this dramatic of a difference but I am absolutely glad that I took a little bit of time to look into the math.

## Conclusions

First off, I really like what the adjacency selection does for the feel of the game. Putting creatures into position applies a sense of space to the combat in the game and, at least for me, helps cultivate an immersive feeling or “realness” to the game that would otherwise be lost in a flat combat system.

My objective with this game is to make players feel like they really are at war. When they send out attackers I want it to feel like the creatures really are traveling a distance to arrive at their opponent’s base. This is reinforced through the interaction in the game, since everything inside of a skirmish is locally contained. You don’t get the “action at a distance” feeling you might in other card games when you can target anything with a spell at any time.

In Algomancy you need to travel to your opponents or have them come to you in order to target them or their creatures with magic. Giving a real sense of presence to the creatures I think helps reinforce this aspect of the game.

That being said, from looking at these graphs I can see that I absolutely need to be careful with complexity. Giving a player a situation with over one million possible actions is a recipe for decision paralysis and information overload; both can lead to extremely long and tedious turns and poor player experience.

Fortunately, there are many solutions to this problem.

The first (and what I am planning to try first) is keeping the expected number of adjacency matters cards that a player might have in play to three or fewer. This can be done by increasing the interaction density so players have more removal to get creatures off the board more often or decreasing the number of “adjacency matters” cards. I think both directions are probably the right direction to go.

I want to spread out the complexity of the game as much as possible across the different phases of the game: drafting, combat declarations and combat interaction. Right now most of the complexity is centralized around the combat declarations stage, so allocating more card designs to make the drafting and combat interaction portions of the game is probably where I need to be. So more cards like “Quick Spell: Target creature gets +3/+3” and less of the “Adjacent creatures get +2/+2”.

I can also translate the adjacency cards into global effects, such as “All fish get +1/+1”. This type of design will serve a similar role and probably play a lot better. Similarly for the slime cannon design, rather than sacrificing an adjacent creature I could let it sacrifice any creature and just limit the number of sacrificed creatures per turn to 3. This would play out roughly the same but allow the players to shortcut many steps of the decision process.

I may even save the adjacency matters roles exclusively for combat styles, with cards like the one below. Test Spike 1 deals damage not just to stuff in front of it, but to the two creatures to the side as well. This type of effect is not something that can be easily replicated with a global effect, like the one mentioned above and is a lot more interesting.

As I am writing this I think this will be my design choice: Completely reserve adjacency matters stuff for situations that couldn’t be handled with a global or targeted effect. Attack directions are cool and unique, and if I can keep the number of them that may be in play to a reasonable amount the complexity cost will not be that bad.

## Caveats

The above analysis was absolutely a “worst case scenario” check. In reality, there are a lot of heuristics we can use as players to quickly prune away a large number of branches from our decision tree. Additionally, there are symmetries that can be exploited to significantly clean things up.

In reality, the difference in complexity between 4 adjacency matters cards and 4 regular cards is likely not as substantial as a factor of 4.

The general shape of these curves, however, would hold true. The symmetries and heuristics may provide a linear offset or a scalar decrease from what our worst case calculations might show, but if you zoom out enough all of these factors will become meaningless relative to the raw difference in scaling between the two situations.

This is the reason for this type of analysis in the first place — we’re not interested in determining exactly how many decisions a player might make, rather, we want to see the general behavior of differently designed environments so we can understand our design space and incorporate that information into our specific card designs.

Also, not all “adjacency matters” designs are created equal. The fish that say “Adjacent creatures get +2/+2” would scale up just fine if you got more and more copies of it. This is mostly true for duplicate copies of similar types of effects: if you just have a bunch of the same type of adjacency effect all in a row it essentially acts like a global effect. Additionally, it is possible that with really large boards the global positioning doesn’t actually matter and only the local positioning would dominate the decision tree size. But, those local positions are all connected in a global structure, so things aren’t exactly that simple. Basically in this paragraph I’m just saying that if I limit my design choices for adjacency matters cards in certain ways, this problem can largely be mitigated.

If you’re interested in following the development of Algomancy, I’ll be posting more blog updates here as well as sending out email notifications for playtesting, polls and release dates on the email list, which you can sign up for here:

[Subscribe for Email Updates](https://5d523f73.sibforms.com/serve/MUIEAF7vNA6WJ2ZoFV10p7ksu5phgloKCCnPRzJGVcW9xFBTc8EcZbvwxYUgZ5KLsrH2Rxdn5cApADnU6I1rXA_PmYdEgclUa2KRdJPXMsUecTAbNu5k9t7dEFF03ix4wqIHnsx6Yp0p9UFLq4yhEWbZCQq9UclNRO47NmIxdod55koSG0J1Ng-VIRCjkG5xZ3EzqWOQg5oEODwo)
