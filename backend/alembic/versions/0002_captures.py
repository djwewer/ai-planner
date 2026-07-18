"""add captures table and tasks.capture_id

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "captures",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("raw_text", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="processing"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_captures_user_id", "captures", ["user_id"])

    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("capture_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key("fk_tasks_capture_id_captures_id", "captures", ["capture_id"], ["id"])
        batch_op.create_index("ix_tasks_capture_id", ["capture_id"])


def downgrade() -> None:
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_index("ix_tasks_capture_id")
        batch_op.drop_constraint("fk_tasks_capture_id_captures_id", type_="foreignkey")
        batch_op.drop_column("capture_id")
    op.drop_index("ix_captures_user_id", table_name="captures")
    op.drop_table("captures")
