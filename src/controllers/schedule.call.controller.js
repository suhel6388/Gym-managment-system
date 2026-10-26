import { prisma } from "../db.js";


export async function AddCall(req, res, next){
try {
    
    const { clientName, mob, callTime, note, ipAddress  } = req.body;
      if (
      typeof clientName !== "string" ||
      !clientName.trim() ||
      clientName.trim().length > 40
    ) {
      return res.status(400).json({
        success: false,
        message: "Client name is required (maximum 40 characters)",
      });
    }
      else if (
      typeof mob !== "string" ||
      !mob.trim() ||
      mob.trim().length > 13
    ) {
      return res.status(400).json({
        success: false,
        message: "Client Mobile Number is required (maximum 13 characters)",
      });
    }

      else if(
      typeof callTime !== "string" ||
      !callTime.trim() ||
      !Number.isFinite(Date.parse(callTime))
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid callTime is required",
      });
    }
     else if (
      note !== undefined &&
      note !== null &&
      (typeof note !== "string" || note.length > 50)
    ) {
      return res.status(400).json({
        success: false,
        message: "Note must be at most 50 characters",
      });
    }

     // Express must be configured correctly behind any reverse proxy.
    const forwarded = req.headers["x-forwarded-for"];
    const ipAdd = req.ip;

    if (!ipAddress) {
      return res.status(400).json({
        success: false,
        message: "Unable to identify client IP",
      });
    }

    

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentCall = await prisma.scheduleCall.findFirst({
      where: {
        ipAddress,
        createdAt: { gt: cutoff },
      },
      orderBy: { createdAt: "desc" },
    });


    if (recentCall) {
      const nextAllowedAt = new Date(
        recentCall.createdAt.getTime() + 24 * 60 * 60 * 1000
      );

      return res.status(429).json({
        success: false,
        message: "Only one call can be scheduled per IP every 24 hours.",
        nextAllowedAt: nextAllowedAt.toISOString(),
      });
    }

      const call = await prisma.scheduleCall.create({
      data: {
        clientName: clientName.trim(),
        Mob:mob.trim(),
        callTime: new Date(callTime),
        note: note?.trim() || null,
        ipAddress:ipAdd,
      },
    });
        return res.status(201).json({
      success: true,
      message: "Call scheduled successfully",
      data: call,
    });


} catch (error) {
      console.error("Schedule call error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to schedule call",
    });
    
}

}



export async function GetAllCall(req, res, next){
  try {
    const calls = await prisma.scheduleCall.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      message:"All call details fetch sucessfully!",
      count: calls.length,
      data: calls,
    });
  } catch (error) {
    console.error("Get all scheduled calls error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch scheduled calls",
    });
  }
};

export async function PatchCall(req, res, next){
  try {
    const id = Number(req.params.id);
    const { clientName, callTime, note } = req.body;

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid call ID",
      });
    }

    const data = {};

    if (clientName !== undefined) {
      if (
        typeof clientName !== "string" ||
        !clientName.trim() ||
        clientName.trim().length > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "Client name must be 1–100 characters",
        });
      }

      data.clientName = clientName.trim();
    }

    if (callTime !== undefined) {
      if (
        typeof callTime !== "string" ||
        !callTime.trim() ||
        !Number.isFinite(Date.parse(callTime))
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid call time",
        });
      }

      data.callTime = new Date(callTime);
    }

    if (note !== undefined) {
      if (note !== null && typeof note !== "string") {
        return res.status(400).json({
          success: false,
          message: "Note must be a string or null",
        });
      }

      if (typeof note === "string" && note.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Note must not exceed 50 characters",
        });
      }

      data.note = note === null ? null : note.trim() || null;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one field to update",
      });
    }

    const existing = await prisma.scheduleCall.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Scheduled call not found",
      });
    }

    const updatedCall = await prisma.scheduleCall.update({
      where: { id },
      data,
    });

    return res.status(200).json({
      success: true,
      message: "Scheduled call updated successfully",
      data: updatedCall,
    });
  } catch (error) {
    console.error("Update scheduled call error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update scheduled call",
    });
  }
};

export async function DeleteCall(req, res, next){
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid call ID",
      });
    }

    const existing = await prisma.scheduleCall.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Scheduled call not found",
      });
    }

    await prisma.scheduleCall.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: "Scheduled call deleted successfully",
    });
  } catch (error) {
    console.error("Delete scheduled call error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete scheduled call",
    });
  }
};