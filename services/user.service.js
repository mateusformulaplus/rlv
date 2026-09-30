import { getPrismaClient } from "../lib/prisma.js"

export const userRepository = {
  findByUsername(username) {
    return getPrismaClient().user.findUnique({ where: { username } })
  },

  findById(id) {
    return getPrismaClient().user.findUnique({ where: { id } })
  },

  list() {
    return getPrismaClient().user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        active: true,
        lastLoginAt: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    })
  },

  create(data) {
    return getPrismaClient().user.create({ data })
  },

  update(id, data) {
    return getPrismaClient().user.update({ where: { id }, data })
  },

  delete(id) {
    return getPrismaClient().user.delete({ where: { id } })
  },

  countAdmins() {
    return getPrismaClient().user.count({ where: { role: "admin", active: true } })
  }
}