import { prisma } from "../db.js";

export async function dashboard(req, res, next) {
  try {
    const gymId = req.user.gymId;
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate()+1);
    const [members, payments, expenses, activeMemberships, expiring] = await Promise.all([
      prisma.member.count({ where: { gymId, archivedAt: null } }),
      prisma.payment.aggregate({ where: { gymId, status: "SUCCESS", paidAt: { gte: todayStart, lt: tomorrow } }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { gymId, expenseDate: { gte: todayStart, lt: tomorrow } }, _sum: { amount: true } }),
      prisma.membership.count({ where: { gymId, status: "ACTIVE", endDate: { gte: now } } }),
      prisma.membership.count({ where: { gymId, status: "ACTIVE", endDate: { gte: now, lte: new Date(now.getTime()+7*86400000) } } })
    ]);
    res.json({ data: {
      totalMembers: members,
      activeMemberships,
      membershipsExpiringIn7Days: expiring,
      collectedTodayPaise: payments._sum.amount || 0,
      expensesTodayPaise: expenses._sum.amount || 0
    }});
  } catch (err) { next(err); }
}

export async function dueMemberships(req, res, next) {
  try {
    const data = await prisma.membership.findMany({
      where: { gymId: req.user.gymId, status: { in: ["ACTIVE", "EXPIRED"] }, endDate: { lte: new Date() } },
      include: { member: true, plan: true },
      orderBy: { endDate: "asc" },
      take: 200
    });
    res.json({ data });
  } catch (err) { next(err); }
}

/**
 * Lightweight join-date feed for the dashboard and reports views.
 *
 * Both screens previously fetched the full `/members` collection (up to 500
 * rows, each with its latest membership and plan) just to count members by
 * join date. This endpoint returns only the two fields those calculations
 * need, keeping the payload small and the counts complete beyond the list cap.
 */
export async function memberJoins(req, res, next) {
  try {
    // The dashboard also labels recent payments with the member's latest plan;
    // reports only need join dates. Keeping that optional avoids sending a
    // membership payload the reports screen would discard.
    const includePlan = req.query.include === "plan";

    const data = await prisma.member.findMany({
      where: { gymId: req.user.gymId, archivedAt: null },
      select: {
        id: true,
        joinedAt: true,
        ...(includePlan
          ? {
              memberships: {
                orderBy: { endDate: "desc" },
                take: 1,
                select: {
                  endDate: true,
                  plan: { select: { id: true, name: true } }
                }
              }
            }
          : {})
      },
      orderBy: { joinedAt: "desc" },
      take: 20000
    });
    res.json({ data });
  } catch (err) { next(err); }
}
