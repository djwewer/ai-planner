"""add scheduling and calendar sync columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("google_calendar_refresh_token", sa.String(), nullable=True)
    )
    op.add_column("tasks", sa.Column("scheduled_at", sa.DateTime(), nullable=True))
    op.add_column("tasks", sa.Column("google_event_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "google_event_id")
    op.drop_column("tasks", "scheduled_at")
    op.drop_column("users", "google_calendar_refresh_token")
