"""add google_task_id column to tasks

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-21

"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("google_task_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "google_task_id")
