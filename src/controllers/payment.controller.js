import { cancelMembership, createMembership, freezeMembership, listMemberships } from "./membership.controller.js";

export const listPayments = listMemberships;
export const createPayment = createMembership;
export const freezePayment = freezeMembership;
export const cancelPayment = cancelMembership;
