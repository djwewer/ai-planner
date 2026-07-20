"""add telegram bot columns and link codes table

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True))
        batch_op.create_unique_constraint("uq_users_telegram_chat_id", ["telegram_chat_id"])

    op.add_column("tasks", sa.Column("reminder_sent_at", sa.DateTime(), nullable=True))
    op.add_column("tasks", sa.Column("last_overdue_nudge_at", sa.DateTime(), nullable=True))

    op.create_table(
        "telegram_link_codes",
        sa.Column("code", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "ix_telegram_link_codes_user_id", "telegram_link_codes", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_telegram_link_codes_user_id", table_name="telegram_link_codes")
    op.drop_table("telegram_link_codes")
    op.drop_column("tasks", "last_overdue_nudge_at")
    op.drop_column("tasks", "reminder_sent_at")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint("uq_users_telegram_chat_id", type_="unique")
        batch_op.drop_column("telegram_chat_id")
