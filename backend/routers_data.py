"""Per-user data endpoints.

Every route requires a JWT (get_current_user) and every query is scoped
to `current_user.id`, so a user can only ever read or change their own
records. Records are addressed by the frontend's own string ids
(`client_id`), so the single-file frontend needs no id mapping.

Two ways to use the API:
  * granular CRUD below — one resource at a time;
  * GET/PUT /api/state — the whole app state in one round trip, which is
    what the SahayakCare frontend uses (its local state is already one
    object). The passcode is local-only and is never sent or stored.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import models
import schemas
from auth import get_current_user
from database import get_db

router = APIRouter()


# ---------------------------------------------------------------- helpers
def _med_out(m: models.Medicine) -> dict:
    return {
        "id": m.client_id, "name": m.name, "dose": m.dose,
        "times": m.times or [], "purpose": m.purpose, "stock": m.stock,
        "notes": m.notes, "createdAt": m.created_at,
    }


def _appt_out(a: models.Appointment) -> dict:
    return {
        "id": a.client_id, "doctor": a.doctor, "specialty": a.specialty,
        "date": a.date, "time": a.time, "place": a.place, "notes": a.notes,
    }


def _member_out(c: models.CareMember) -> dict:
    return {
        "id": c.client_id, "name": c.name, "role": c.role,
        "phone": c.phone, "email": c.email, "status": c.status,
    }


def _vital_out(v: models.Vital) -> dict:
    return {
        "id": v.client_id, "type": v.type, "value": v.value,
        "date": v.date, "note": v.note,
    }


def _dose_out(d: models.DoseLog) -> dict:
    return {
        "date": d.date, "medicine_id": d.medicine_client_id,
        "slot": d.slot, "status": d.status,
    }


def _require_times(med: schemas.MedicineIn):
    # A medicine with no time slots never appears in today's doses.
    if not med.times:
        raise HTTPException(
            status_code=422, detail="Pick at least one time slot"
        )


def _get_or_404(query, client_id: str, what: str):
    row = query.filter_by(client_id=client_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"{what} not found")
    return row


# ---------------------------------------------------------------- medicines
@router.get("/medicines", response_model=list[schemas.MedicineOut])
def list_medicines(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(models.Medicine).filter_by(user_id=current_user.id).all()
    return [_med_out(m) for m in rows]


@router.post("/medicines", response_model=schemas.MedicineOut, status_code=201)
def create_medicine(
    med: schemas.MedicineIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.query(models.Medicine).filter_by(user_id=current_user.id, client_id=med.id).first():
        raise HTTPException(status_code=400, detail="Medicine id already exists")
    _require_times(med)
    row = models.Medicine(
        user_id=current_user.id, client_id=med.id, name=med.name, dose=med.dose,
        times=med.times, purpose=med.purpose, stock=med.stock,
        notes=med.notes, created_at=med.createdAt,
    )
    db.add(row)
    db.commit()
    return _med_out(row)


@router.put("/medicines/{client_id}", response_model=schemas.MedicineOut)
def update_medicine(
    client_id: str,
    med: schemas.MedicineIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_or_404(
        db.query(models.Medicine).filter_by(user_id=current_user.id), client_id, "Medicine"
    )
    _require_times(med)
    row.name, row.dose, row.times = med.name, med.dose, med.times
    row.purpose, row.stock, row.notes = med.purpose, med.stock, med.notes
    row.created_at = med.createdAt
    db.commit()
    return _med_out(row)


@router.delete("/medicines/{client_id}", status_code=204)
def delete_medicine(
    client_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_or_404(
        db.query(models.Medicine).filter_by(user_id=current_user.id), client_id, "Medicine"
    )
    db.delete(row)
    db.commit()
    return None


# ---------------------------------------------------------------- appointments
@router.get("/appointments", response_model=list[schemas.AppointmentOut])
def list_appointments(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(models.Appointment).filter_by(user_id=current_user.id).all()
    return [_appt_out(a) for a in rows]


@router.post("/appointments", response_model=schemas.AppointmentOut, status_code=201)
def create_appointment(
    appt: schemas.AppointmentIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.query(models.Appointment).filter_by(user_id=current_user.id, client_id=appt.id).first():
        raise HTTPException(status_code=400, detail="Appointment id already exists")
    row = models.Appointment(
        user_id=current_user.id, client_id=appt.id, doctor=appt.doctor,
        specialty=appt.specialty, date=appt.date, time=appt.time,
        place=appt.place, notes=appt.notes,
    )
    db.add(row)
    db.commit()
    return _appt_out(row)


@router.put("/appointments/{client_id}", response_model=schemas.AppointmentOut)
def update_appointment(
    client_id: str,
    appt: schemas.AppointmentIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_or_404(
        db.query(models.Appointment).filter_by(user_id=current_user.id),
        client_id, "Appointment",
    )
    row.doctor, row.specialty, row.date = appt.doctor, appt.specialty, appt.date
    row.time, row.place, row.notes = appt.time, appt.place, appt.notes
    db.commit()
    return _appt_out(row)


@router.delete("/appointments/{client_id}", status_code=204)
def delete_appointment(
    client_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_or_404(
        db.query(models.Appointment).filter_by(user_id=current_user.id),
        client_id, "Appointment",
    )
    db.delete(row)
    db.commit()
    return None


# ---------------------------------------------------------------- care circle
@router.get("/members", response_model=list[schemas.CareMemberOut])
def list_members(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(models.CareMember).filter_by(user_id=current_user.id).all()
    return [_member_out(c) for c in rows]


@router.post("/members", response_model=schemas.CareMemberOut, status_code=201)
def create_member(
    member: schemas.CareMemberIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.query(models.CareMember).filter_by(user_id=current_user.id, client_id=member.id).first():
        raise HTTPException(status_code=400, detail="Member id already exists")
    row = models.CareMember(
        user_id=current_user.id, client_id=member.id, name=member.name,
        role=member.role, phone=member.phone, email=member.email,
        status=member.status,
    )
    db.add(row)
    db.commit()
    return _member_out(row)


@router.put("/members/{client_id}", response_model=schemas.CareMemberOut)
def update_member(
    client_id: str,
    member: schemas.CareMemberIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_or_404(
        db.query(models.CareMember).filter_by(user_id=current_user.id),
        client_id, "Member",
    )
    row.name, row.role, row.phone = member.name, member.role, member.phone
    row.email, row.status = member.email, member.status
    db.commit()
    return _member_out(row)


@router.delete("/members/{client_id}", status_code=204)
def delete_member(
    client_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_or_404(
        db.query(models.CareMember).filter_by(user_id=current_user.id),
        client_id, "Member",
    )
    db.delete(row)
    db.commit()
    return None


# ---------------------------------------------------------------- vitals
@router.get("/vitals", response_model=list[schemas.VitalOut])
def list_vitals(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(models.Vital).filter_by(user_id=current_user.id).all()
    return [_vital_out(v) for v in rows]


@router.post("/vitals", response_model=schemas.VitalOut, status_code=201)
def create_vital(
    vital: schemas.VitalIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.query(models.Vital).filter_by(user_id=current_user.id, client_id=vital.id).first():
        raise HTTPException(status_code=400, detail="Vital id already exists")
    row = models.Vital(
        user_id=current_user.id, client_id=vital.id, type=vital.type,
        value=vital.value, date=vital.date, note=vital.note,
    )
    db.add(row)
    db.commit()
    return _vital_out(row)


@router.delete("/vitals/{client_id}", status_code=204)
def delete_vital(
    client_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _get_or_404(
        db.query(models.Vital).filter_by(user_id=current_user.id), client_id, "Vital"
    )
    db.delete(row)
    db.commit()
    return None


# ---------------------------------------------------------------- dose log
@router.get("/doses", response_model=list[schemas.DoseOut])
def list_doses(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(models.DoseLog).filter_by(user_id=current_user.id)
    if date_from:
        q = q.filter(models.DoseLog.date >= date_from)
    if date_to:
        q = q.filter(models.DoseLog.date <= date_to)
    return [_dose_out(d) for d in q.all()]


@router.post("/doses", response_model=schemas.DoseOut, status_code=201)
def upsert_dose(
    dose: schemas.DoseIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(models.DoseLog).filter_by(
        user_id=current_user.id, date=dose.date,
        medicine_client_id=dose.medicine_id, slot=dose.slot,
    ).first()
    if row is None:
        row = models.DoseLog(
            user_id=current_user.id, date=dose.date,
            medicine_client_id=dose.medicine_id, slot=dose.slot,
            status=dose.status,
        )
        db.add(row)
    else:
        row.status = dose.status
    db.commit()
    return _dose_out(row)


# ---------------------------------------------------------------- whole-state sync
@router.get("/state", response_model=schemas.StateSync)
def get_state(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meds = db.query(models.Medicine).filter_by(user_id=current_user.id).all()
    appts = db.query(models.Appointment).filter_by(user_id=current_user.id).all()
    members = db.query(models.CareMember).filter_by(user_id=current_user.id).all()
    vitals = db.query(models.Vital).filter_by(user_id=current_user.id).all()
    doses = db.query(models.DoseLog).filter_by(user_id=current_user.id).all()
    if not (meds or appts or members or vitals or doses):
        # Never saved anything yet — the frontend keeps its local data
        # and pushes it on the next save instead of wiping to empty.
        # But if the user explicitly saved an empty state (StateMeta row),
        # the empty state is real data: return it with 200, not 404.
        has_saved = db.query(models.StateMeta).filter_by(user_id=current_user.id).first()
        if not has_saved:
            raise HTTPException(status_code=404, detail="No saved state yet")
        return {"medicines": [], "appointments": [], "circle": [],
                "vitals": [], "doseLog": {}}
    return {
        "medicines": [_med_out(m) for m in meds],
        "appointments": [_appt_out(a) for a in appts],
        "circle": [_member_out(c) for c in members],
        "vitals": [_vital_out(v) for v in vitals],
        "doseLog": {
            f"{d.date}|{d.medicine_client_id}|{d.slot}": d.status for d in doses
        },
    }


@router.put("/state", response_model=schemas.StateSync)
def put_state(
    payload: schemas.StateSync,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Replace the user's whole state in one transaction.
    for table in (models.Medicine, models.Appointment, models.CareMember,
                  models.Vital, models.DoseLog):
        db.query(table).filter_by(user_id=current_user.id).delete()
    for m in payload.medicines:
        db.add(models.Medicine(
            user_id=current_user.id, client_id=m.id, name=m.name, dose=m.dose,
            times=m.times, purpose=m.purpose, stock=m.stock,
            notes=m.notes, created_at=m.createdAt,
        ))
    for a in payload.appointments:
        db.add(models.Appointment(
            user_id=current_user.id, client_id=a.id, doctor=a.doctor,
            specialty=a.specialty, date=a.date, time=a.time,
            place=a.place, notes=a.notes,
        ))
    for c in payload.circle:
        db.add(models.CareMember(
            user_id=current_user.id, client_id=c.id, name=c.name, role=c.role,
            phone=c.phone, email=c.email, status=c.status,
        ))
    for v in payload.vitals:
        db.add(models.Vital(
            user_id=current_user.id, client_id=v.id, type=v.type,
            value=v.value, date=v.date, note=v.note,
        ))
    for key, status in payload.doseLog.items():
        parts = key.split("|")
        # A malformed dose key is a 422, not a silent skip: silently
        # dropping entries would lose dose history without a trace.
        if (
            len(parts) != 3
            or parts[2] not in ("morning", "afternoon", "evening", "night")
            or status not in ("taken", "missed")
        ):
            raise HTTPException(status_code=422, detail=f"Malformed dose key: {key}")
        db.add(models.DoseLog(
            user_id=current_user.id, date=parts[0],
            medicine_client_id=parts[1], slot=parts[2], status=status,
        ))
    # Mark that this user has saved a state (even an empty one) so a later
    # GET can tell "saved empty" apart from "never saved".
    if db.query(models.StateMeta).filter_by(user_id=current_user.id).first() is None:
        db.add(models.StateMeta(user_id=current_user.id))
    db.commit()
    # Return the state just written. (Do not call get_state() here: it
    # raises 404 when every table is empty, so an empty PUT used to answer
    # 404 after a successful write.)
    return {
        "medicines": [m.model_dump() for m in payload.medicines],
        "appointments": [a.model_dump() for a in payload.appointments],
        "circle": [c.model_dump() for c in payload.circle],
        "vitals": [v.model_dump() for v in payload.vitals],
        "doseLog": dict(payload.doseLog),
    }
