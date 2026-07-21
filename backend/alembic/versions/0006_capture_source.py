"""add source column to captures

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-21

"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("captures", sa.Column("source", sa.String(), nullable=False, server_default="web"))


def downgrade() -> None:
    op.drop_column("captures", "source")
