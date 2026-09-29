import {
  createCatalog,
  deactivateCatalog,
  getCatalogById,
  listCatalog,
  updateCatalog,
} from '../services/catalogService.js'

export function catalogController(name) {
  return {
    list: async (request, response, next) => {
      try {
        response.json(await listCatalog(name, request.query))
      } catch (error) {
        next(error)
      }
    },
    get: async (request, response, next) => {
      try {
        response.json(await getCatalogById(name, request.params.id))
      } catch (error) {
        next(error)
      }
    },
    create: async (request, response, next) => {
      try {
        response.status(201).json(await createCatalog(name, request.body))
      } catch (error) {
        next(error)
      }
    },
    update: async (request, response, next) => {
      try {
        response.json(await updateCatalog(name, request.params.id, request.body))
      } catch (error) {
        next(error)
      }
    },
    deactivate: async (request, response, next) => {
      try {
        await deactivateCatalog(name, request.params.id)
        response.status(204).end()
      } catch (error) {
        next(error)
      }
    },
  }
}