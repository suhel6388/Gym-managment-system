import { prisma } from "../db.js";

export async function dashboard(req, res, next) {
  try {
    const gymId = req.user.gymId;
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate()+1);
    const [members, payments, expenses, activeMemberships, expiring] = await Promise.all([
      prisma.member.count({ where: { gymId, archivedAt: null } }),
      prisma.payment.aggregate({ where: { gymId, status: "SUCCESS", paidAt: { gte: todayStart, lt: tomorrow } }, _sum: { amountPaise: true } }),
      prisma.expense.aggregate({ where: { gymId, expenseDate: { gte: todayStart, lt: tomorrow } }, _sum: { amountPaise: true } }),
      prisma.membership.count({ where: { gymId, status: "ACTIVE", endDate: { gte: now } } }),
      prisma.membership.count({ where: { gymId, status: "ACTIVE", endDate: { gte: now, lte: new Date(now.getTime()+7*86400000) } } })
    ]);
    res.json({ data: {
      totalMembers: members,
      activeMemberships,
      membershipsExpiringIn7Days: expiring,
      collectedTodayPaise: payments._sum.amountPaise || 0,
      expensesTodayPaise: expenses._sum.amountPaise || 0
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
