"""SQLAlchemy models.

Every record belongs to one user (user_id). All queries are scoped to the
logged-in user, so users can only ever see their own data.

`client_id` is the id the frontend already uses (e.g. "m1", "a2") — the
API stores it as-is so the single-file frontend can sync its whole state
without an id-mapping layer.
"""
from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    medicines = relationship("Medicine", back_populates="owner", cascade="all, delete-orphan")
    appointments = relationship("Appointment", back_populates="owner", cascade="all, delete-orphan")
    members = relationship("CareMember", back_populates="owner", cascade="all, delete-orphan")
    vitals = relationship("Vital", back_populates="owner", cascade="all, delete-orphan")
    doses = relationship("DoseLog", back_populates="owner", cascade="all, delete-orphan")


class Medicine(Base):
    __tablename__ = "medicines"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    client_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    dose = Column(String, nullable=False)
    times = Column(JSON, nullable=False, default=list)  # e.g. ["morning", "night"]
    purpose = Column(String, default="")
    # None = "not tracked" (blank stock in the frontend). No default=0:
    # a column default would turn an explicit NULL back into 0.
    stock = Column(Integer, nullable=True)
    notes = Column(Text, default="")
    created_at = Column(String, default="")  # YYYY-MM-DD, from the frontend

    owner = relationship("User", back_populates="medicines")

    __table_args__ = (UniqueConstraint("user_id", "client_id", name="uq_med_user_client"),)


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    client_id = Column(String, nullable=False)
    doctor = Column(String, nullable=False)
    specialty = Column(String, default="")
    date = Column(String, nullable=False)  # YYYY-MM-DD
    time = Column(String, default="")
    place = Column(String, default="")
    notes = Column(Text, default="")

    owner = relationship("User", back_populates="appointments")

    __table_args__ = (UniqueConstraint("user_id", "client_id", name="uq_appt_user_client"),)


class CareMember(Base):
    __tablename__ = "care_members"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    client_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, default="Family")
    phone = Column(String, default="")
    email = Column(String, default="")
    status = Column(String, default="pending")  # pending | approved

    owner = relationship("User", back_populates="members")

    __table_args__ = (UniqueConstraint("user_id", "client_id", name="uq_member_user_client"),)


class Vital(Base):
    __tablename__ = "vitals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    client_id = Column(String, nullable=False)
    type = Column(String, nullable=False)  # Blood Pressure | Blood Sugar | Weight | Pulse
    value = Column(String, nullable=False)
    date = Column(String, nullable=False)  # YYYY-MM-DD
    note = Column(String, default="")

    owner = relationship("User", back_populates="vitals")

    __table_args__ = (UniqueConstraint("user_id", "client_id", name="uq_vital_user_client"),)


class DoseLog(Base):
    __tablename__ = "dose_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    date = Column(String, nullable=False)  # YYYY-MM-DD
    medicine_client_id = Column(String, nullable=False)
    slot = Column(String, nullable=False)  # morning | afternoon | evening | night
    status = Column(String, nullable=False)  # taken | missed

    owner = relationship("User", back_populates="doses")

    __table_args__ = (
        UniqueConstraint(
            "user_id", "date", "medicine_client_id", "slot",
            name="uq_dose_user_date_med_slot",
        ),
    )


class StateMeta(Base):
    """One row per user that has ever saved a whole state via PUT /api/state.

    Lets GET /api/state tell "never saved anything" (no row -> 404, so the
    frontend keeps its local data) apart from "explicitly saved an empty
    state" (row exists -> 200 with empty arrays). Without this marker an
    empty PUT would be indistinguishable from never having saved.
    """

    __tablename__ = "state_meta"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now())
