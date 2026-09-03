"""
cogs/judge.py — asking the rules bot a question, and telling it when it is wrong.

⚠ `/ask` IS DELIBERATELY NOT EPHEMERAL, and it is the reason the ephemeral
policy in common.py has an exception at all: an ephemeral message CANNOT have
a thread, and the thread is the feature. A question opens one, the answer seeds
it, and plain messages typed in it stay in context — that last part is the only
job the privileged message-content intent still has after the slash migration.

⚠ `/feedback` MUST NOT DEFER. `send_modal()` IS an initial response, so a
deferred interaction can no longer open one. It is the only command here that
skips `start()`, and it replaces the old `&feedback` thread — which was
strictly worse: it kept its thread ids in a set that a restart lost, and its
own comment in bot.py apologised for exactly that.
"""

import asyncio

import discord
from discord import app_commands
from discord.ext import commands

import core
import store
from core import answer_question
from discordui import answer_embed

from .common import fail, start

# How long to wait on the model before giving up and saying so. `core`'s own
# call has no timeout, so without this a hung API request leaves the "thinking"
# spinner up until Discord expires the interaction fifteen minutes later.
ANSWER_TIMEOUT = 600


class FeedbackModal(discord.ui.Modal, title="Feedback about the bot"):
    note = discord.ui.TextInput(
        label="What would you change?",
        style=discord.TextStyle.paragraph,
        placeholder="Anything about the bot itself — not about one answer.",
        max_length=2000,
    )

    async def on_submit(self, interaction: discord.Interaction):
        store.log_general_feedback(str(self.note), interaction.user.id,
                                   channel_id=interaction.channel_id)
        await interaction.response.send_message(
            "📝 Thanks — recorded.", ephemeral=True)


class Judge(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        from bot import FeedbackButton
        self.bot.add_dynamic_items(FeedbackButton)

    @app_commands.command(name="ask", description="Ask a rules question")
    @app_commands.describe(question="Your rules question.")
    async def ask(self, interaction: discord.Interaction, question: str):
        # Public: the answer opens a thread, and an ephemeral message cannot
        # have one. See the header.
        await start(interaction)
        try:
            answer, hits, reasoning = await asyncio.wait_for(
                answer_question(question, history=[]), timeout=ANSWER_TIMEOUT)
        except asyncio.TimeoutError:
            await fail(interaction, "⚠️ The model took too long. Try again, or "
                                    "ask a narrower question.")
            return
        except Exception as exc:
            await fail(interaction, f"⚠️ Couldn't reach the model: `{exc}`")
            return

        from bot import THREADS, feedback_view, post_cited_cards
        rid = store.new_response_id()
        store.log_response(rid, "ask", question, answer, hits, core.DEEPSEEK_MODEL,
                           user_id=interaction.user.id, channel_id=interaction.channel_id,
                           reasoning=reasoning, engine_version=core.ENGINE_VERSION)
        # wait=True so we get a Message back — a WebhookMessage, which
        # subclasses Message and so can still open a thread.
        msg = await interaction.followup.send(
            embed=answer_embed(question, answer, hits, reasoning),
            view=feedback_view(rid), wait=True)
        try:
            thread = await msg.create_thread(name=question[:90], auto_archive_duration=60)
        except discord.HTTPException:
            return  # DMs, or anywhere sub-threads are not allowed: no follow-ups
        # Tracked BEFORE anything else can fail, so a thread that exists is
        # always one the bot answers in. (This used to sit inside one try with
        # the two sends after it, and a failed send left an untracked thread.)
        THREADS[thread.id] = [
            {"role": "user", "content": question},
            {"role": "assistant", "content": answer},
        ]
        try:
            await thread.send("🧵 Ask follow-up questions in this thread — "
                              "I'll keep the context.")
            await post_cited_cards(thread, answer, hits)
        except discord.HTTPException as exc:
            print(f"[ask] thread {thread.id} opened but the intro failed: {exc}")

    @app_commands.command(name="feedback",
                          description="Tell Ben what you'd change about the bot")
    async def feedback(self, interaction: discord.Interaction):
        # ⚠ NO defer — see the header.
        await interaction.response.send_modal(FeedbackModal())
