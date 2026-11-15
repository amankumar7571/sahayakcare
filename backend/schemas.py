"""Pydantic schemas — the exact JSON shapes the API speaks.

The frontend's local state uses these same field names, so a state sync
is a plain JSON round-trip (except `passcode`, which is local-only and
never sent to the server).
"""
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


# ---------------------------------------------------------------- auth
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    # 1-character passwords were accepted before; 8 is the minimum.
    password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: int
    name: str
    email: str

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    email: Optional[str] = None


# ---------------------------------------------------------------- data
class MedicineIn(BaseModel):
    id: str
    name: str
    dose: str
    # Only the four known slots are accepted (an invalid slot is a 422);
    # the list may be empty at the schema level so an old synced state
    # with a zero-slot medicine still loads — the frontend blocks creating
    # a medicine with no slots, and flags existing ones in the UI.
    times: list[Literal["morning", "afternoon", "evening", "night"]] = []
    purpose: str = ""
    # None = "not tracked" (blank stock in the frontend); never negative.
    stock: Optional[int] = Field(default=0, ge=0)
    notes: str = ""
    createdAt: str = ""


class MedicineOut(MedicineIn):
    pass


class AppointmentIn(BaseModel):
    id: str
    doctor: str
    specialty: str = ""
    date: str
    time: str = ""
    place: str = ""
    notes: str = ""


class AppointmentOut(AppointmentIn):
    pass


class CareMemberIn(BaseModel):
    id: str
    name: str
    role: str = "Family"
    phone: str = ""
    email: str = ""
    status: Literal["pending", "approved"] = "pending"


class CareMemberOut(CareMemberIn):
    pass


class VitalIn(BaseModel):
    id: str
    type: str
    value: str
    date: str
    note: str = ""


class VitalOut(VitalIn):
    pass


class DoseIn(BaseModel):
    date: str
    medicine_id: str
    slot: Literal["morning", "afternoon", "evening", "night"]
    status: Literal["taken", "missed"]


class DoseOut(DoseIn):
    pass


class StateSync(BaseModel):
    """Whole-app state, exactly as the frontend keeps it (minus passcode)."""

    medicines: list[MedicineIn] = []
    appointments: list[AppointmentIn] = []
    circle: list[CareMemberIn] = []
    vitals: list[VitalIn] = []
    doseLog: dict[str, Literal["taken", "missed"]] = {}
