import WebinyError from "@webiny/error";
import lodashGet from "lodash/get";
import {
    Page,
    PageStorageOperations,
    PageStorageOperationsCreateFromParams,
    PageStorageOperationsCreateParams,
    PageStorageOperationsDeleteAllParams,
    PageStorageOperationsDeleteParams,
    PageStorageOperationsGetParams,
    PageStorageOperationsGetByPathParams,
    PageStorageOperationsListParams,
    PageStorageOperationsListResponse,
    PageStorageOperationsListRevisionsParams,
    PageStorageOperationsListTagsParams,
    PageStorageOperationsPublishParams,
    PageStorageOperationsRequestChangesParams,
    PageStorageOperationsRequestReviewParams,
    PageStorageOperationsUnpublishParams,
    PageStorageOperationsUpdateParams
} from "@webiny/api-page-builder/types";
import { get as entityGet } from "@webiny/db-dynamodb/utils/get";
import { Entity } from "dynamodb-toolbox";
import { cleanupItem } from "@webiny/db-dynamodb/utils/cleanup";
import { DbItem, queryAll, QueryAllParams, queryOne } from "@webiny/db-dynamodb/utils/query";
import { batchWriteAll } from "@webiny/db-dynamodb/utils/batchWrite";
import { filterItems } from "@webiny/db-dynamodb/utils/filter";
import { sortItems } from "@webiny/db-dynamodb/utils/sort";
import { decodeCursor, encodeCursor } from "@webiny/db-dynamodb/utils/cursor";
import { PageDynamoDbFieldPlugin } from "~/plugins/definitions/PageDynamoDbFieldPlugin";
import { PluginsContainer } from "@webiny/plugins";
import {
    createLatestPartitionKey,
    createLatestSortKey,
    createPathPartitionKey,
    createPathSortKey,
    createPublishedPartitionKey,
    createPublishedSortKey,
    createRevisionPartitionKey,
    createRevisionSortKey
} from "~/operations/pages/keys";

const GSI1_INDEX = "GSI1";

/**
 * To be able to efficiently query pages we need the following records in the database:
 * - latest
 *      PK - fixed string + #L
 *      SK - pageId
 * - revision
 *      PK - fixed string + pageId
 *      SK - version
 * - published
 *      PK - fixed string + #P
 *      SK - pageId
 * - path
 *      PK - fixed string + #PATH
 *      SK - path
 */

const createRevisionType = (): string => {
    return "pb.page";
};
/**
 * Type that marks latest page record.
 */
const createLatestType = (): string => {
    return "pb.page.l";
};
/**
 * Type that marks published page record.
 */
const createPublishedType = (): string => {
    return "pb.page.p";
};

export interface Params {
    entity: Entity<any>;
    plugins: PluginsContainer;
}
export const createPageStorageOperations = (params: Params): PageStorageOperations => {
    const { entity, plugins } = params;

    const create = async (params: PageStorageOperationsCreateParams): Promise<Page> => {
        const { page } = params;

        const revisionKeys = {
            PK: createRevisionPartitionKey(page),
            SK: createRevisionSortKey(page)
        };
        const latestKeys = {
            PK: createLatestPartitionKey(page),
            SK: createLatestSortKey(page)
        };

        const titleLC = page.title.toLowerCase();
        /**
         * We need to create
         * - latest
         * - revision
         */
        const items = [
            entity.putBatch({
                ...page,
                titleLC,
                ...latestKeys,
                TYPE: createLatestType()
            }),
            entity.putBatch({
                ...page,
                titleLC,
                ...revisionKeys,
                TYPE: createRevisionType()
            })
        ];
        try {
            await batchWriteAll({
                table: entity.table,
                items
            });
            return page;
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not create new page.",
                ex.code || "CREATE_PAGE_ERROR",
                {
                    revisionKeys,
                    latestKeys,
                    page
                }
            );
        }
    };

    const createFrom = async (params: PageStorageOperationsCreateFromParams): Promise<Page> => {
        const { page, latestPage, original } = params;

        const revisionKeys = {
            PK: createRevisionPartitionKey(page),
            SK: createRevisionSortKey(page)
        };
        const latestKeys = {
            PK: createLatestPartitionKey(page),
            SK: createLatestSortKey(page)
        };
        /**
         * We need to create
         * - latest
         * - revision
         */
        const items = [
            entity.putBatch({
                ...page,
                ...latestKeys,
                TYPE: createLatestType()
            }),
            entity.putBatch({
                ...page,
                ...revisionKeys,
                TYPE: createRevisionType()
            })
        ];

        try {
            await batchWriteAll({
                table: entity.table,
                items
            });
            return page;
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not create new page from existing page.",
                ex.code || "CREATE_PAGE_FROM_ERROR",
                {
                    revisionKeys,
                    latestKeys,
                    latestPage,
                    original,
                    page
                }
            );
        }
    };

    const update = async (params: PageStorageOperationsUpdateParams): Promise<Page> => {
        const { original, page } = params;

        const revisionKeys = {
            PK: createRevisionPartitionKey(page),
            SK: createRevisionSortKey(page)
        };
        const latestKeys = {
            PK: createLatestPartitionKey(page),
            SK: createLatestSortKey(page)
        };

        const latestPageResult = await entityGet<Page>({
            entity,
            keys: latestKeys
        });
        const latestPage = cleanupItem(entity, latestPageResult);

        const titleLC = page.title.toLowerCase();
        /**
         * We need to update
         * - revision
         * - latest if this is the latest
         */
        const items = [
            entity.putBatch({
                ...page,
                titleLC,
                ...revisionKeys,
                TYPE: createRevisionType()
            })
        ];
        /**
         * Latest if it is the one.
         */
        if (latestPage && latestPage.id === page.id) {
            items.push(
                entity.putBatch({
                    ...page,
                    titleLC,
                    ...latestKeys,
                    TYPE: createLatestType()
                })
            );
        }

        try {
            await batchWriteAll({
                table: entity.table,
                items
            });

            return page;
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not update existing page.",
                ex.code || "UPDATE_PAGE_ERROR",
                {
                    original,
                    page,
                    latestPage,
                    latestKeys,
                    revisionKeys
                }
            );
        }
    };

    const deleteOne = async (
        params: PageStorageOperationsDeleteParams
    ): Promise<[Page, Page | null]> => {
        const { page, latestPage, publishedPage } = params;

        const revisionKeys = {
            PK: createRevisionPartitionKey(page),
            SK: createRevisionSortKey(page)
        };
        const latestKeys = {
            PK: createLatestPartitionKey(page),
            SK: createLatestSortKey(page)
        };
        const publishedKeys = {
            PK: createPublishedPartitionKey(page),
            SK: createPublishedSortKey(page)
        };

        /**
         * We need to delete
         * - revision
         * - published if is published
         * We need to update
         * - latest, if it exists, with previous record
         */
        const items = [entity.deleteBatch(revisionKeys)];
        if (publishedPage && publishedPage.id === page.id) {
            items.push(entity.deleteBatch(publishedKeys));
        }
        let previousLatestPage: Page = null;
        if (latestPage && latestPage.id === page.id) {
            const partitionKey = createRevisionPartitionKey(page);
            const previousLatestRecord = await queryOne<Page>({
                entity,
                partitionKey,
                options: {
                    lt: createRevisionSortKey(latestPage),
                    reverse: true
                }
            });
            if (previousLatestRecord) {
                items.push(
                    entity.putBatch({
                        ...previousLatestRecord,
                        ...latestKeys,
                        TYPE: createLatestType()
                    })
                );
                previousLatestPage = cleanupItem(entity, previousLatestRecord);
            }
        }
        try {
            await batchWriteAll({
                table: entity.table,
                items
            });
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not batch write all the page records.",
                ex.code || "BATCH_WRITE_RECORDS_ERROR"
            );
        }
        return [page, previousLatestPage];
    };

    /**
     * We need to delete
     * - latest
     * - published
     * - path
     * - all revisions
     */
    const deleteAll = async (params: PageStorageOperationsDeleteAllParams): Promise<[Page]> => {
        const { page } = params;

        const partitionKey = createRevisionPartitionKey(page);
        const queryAllParams = {
            entity,
            partitionKey,
            options: {
                gte: " "
            }
        };
        const latestKeys = {
            PK: createLatestPartitionKey(page),
            SK: createLatestSortKey(page)
        };
        const publishedKeys = {
            PK: createPublishedPartitionKey(page),
            SK: createPublishedSortKey(page)
        };

        const items = [entity.deleteBatch(latestKeys)];

        let revisions: DbItem<Page>[];
        try {
            revisions = await queryAll(queryAllParams);
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not query for all revisions of the page.",
                ex.code || "LIST_REVISIONS_ERROR",
                {
                    params: queryAllParams
                }
            );
        }

        let deletedPublishedRecord = false;
        /**
         * We need to go through all possible entries and delete them.
         * Also, delete the published entry path record.
         */
        for (const revision of revisions) {
            if (!deletedPublishedRecord && revision.status === "published") {
                items.push(entity.deleteBatch(publishedKeys));
                deletedPublishedRecord = true;
            }
            items.push(
                entity.deleteBatch({
                    PK: revision.PK,
                    SK: revision.SK
                })
            );
        }

        try {
            await batchWriteAll({
                table: entity.table,
                items
            });
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not delete all the page records.",
                ex.code || "DELETE_RECORDS_ERROR"
            );
        }
        return [page];
    };

    /**
     * We need to
     * - update revision that it is published
     * - if is latest update record that it is published
     * - set status of previously published page to unpublished
     * - create / update published record
     * - create / update published path
     */
    const publish = async (params: PageStorageOperationsPublishParams): Promise<Page> => {
        const { page, latestPage, publishedPage } = params;

        const revisionKeys = {
            PK: createRevisionPartitionKey(page),
            SK: createRevisionSortKey(page)
        };
        const latestKeys = {
            PK: createLatestPartitionKey(page),
            SK: createLatestSortKey(page)
        };
        const publishedKeys = {
            PK: createPublishedPartitionKey(page),
            SK: createPublishedSortKey(page)
        };
        /**
         * Update the given revision of the page.
         */
        const items = [
            entity.putBatch({
                ...page,
                ...revisionKeys,
                TYPE: createRevisionType()
            })
        ];

        if (latestPage.id === page.id) {
            items.push(
                entity.putBatch({
                    ...page,
                    ...latestKeys,
                    TYPE: createLatestType()
                })
            );
        }
        /**
         * If we have already published revision of this page:
         *  - set existing published page revision to unpublished
         */
        if (publishedPage) {
            const publishedRevisionKeys = {
                PK: createRevisionPartitionKey(publishedPage),
                SK: createRevisionSortKey(publishedPage)
            };
            items.push(
                entity.putBatch({
                    ...publishedPage,
                    status: "unpublished",
                    ...publishedRevisionKeys,
                    TYPE: createRevisionType()
                })
            );
        }

        items.push(
            entity.putBatch({
                ...page,
                ...publishedKeys,
                GSI1_PK: createPathPartitionKey(page),
                GSI1_SK: page.path,
                TYPE: createPublishedType()
            })
        );

        try {
            await batchWriteAll({
                table: entity.table,
                items
            });
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not update all the page records when publishing.",
                ex.code || "UPDATE_RECORDS_ERROR"
            );
        }
        return page;
    };

    /**
     * We need to
     * - update revision record with new status
     * - remove published record
     * - remove published path record
     * - update latest record with new status if is the latest
     */
    const unpublish = async (params: PageStorageOperationsUnpublishParams): Promise<Page> => {
        const { page, latestPage } = params;

        const revisionKeys = {
            PK: createRevisionPartitionKey(page),
            SK: createRevisionSortKey(page)
        };
        const latestKeys = {
            PK: createLatestPartitionKey(page),
            SK: createLatestSortKey(page)
        };
        const publishedKeys = {
            PK: createPublishedPartitionKey(page),
            SK: createPublishedSortKey(page)
        };

        const items = [
            entity.putBatch({
                ...page,
                ...revisionKeys,
                TYPE: createRevisionType()
            }),
            entity.deleteBatch(publishedKeys)
        ];

        if (latestPage.id === page.id) {
            items.push(
                entity.putBatch({
                    ...page,
                    ...latestKeys,
                    TYPE: createLatestType()
                })
            );
        }

        try {
            await batchWriteAll({
                table: entity.table,
                items
            });
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not update all the page records when unpublishing.",
                ex.code || "UPDATE_RECORDS_ERROR"
            );
        }
        return page;
    };

    /**
     * We need to
     * - update revision record
     * - update latest record if it is the latest record
     */
    const requestReview = async (
        params: PageStorageOperationsRequestReviewParams
    ): Promise<Page> => {
        const { original, page, latestPage } = params;

        const revisionKeys = {
            PK: createRevisionPartitionKey(page),
            SK: createRevisionSortKey(page)
        };
        const latestKeys = {
            PK: createLatestPartitionKey(page),
            SK: createLatestSortKey(page)
        };

        const items = [
            entity.putBatch({
                ...page,
                ...revisionKeys,
                TYPE: createRevisionType()
            })
        ];
        if (latestPage.id === page.id) {
            items.push(
                entity.putBatch({
                    ...page,
                    ...latestKeys,
                    TYPE: createLatestType()
                })
            );
        }
        try {
            await batchWriteAll({
                table: entity.table,
                items
            });
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not request review on page record.",
                ex.code || "REQUEST_REVIEW_ERROR",
                {
                    original,
                    page,
                    latestPage
                }
            );
        }
        return page;
    };

    /**
     * We need to
     * - update revision record
     * - update latest record if it is the latest one
     */
    const requestChanges = async (
        params: PageStorageOperationsRequestChangesParams
    ): Promise<Page> => {
        const { original, page, latestPage } = params;

        const revisionKeys = {
            PK: createRevisionPartitionKey(page),
            SK: createRevisionSortKey(page)
        };
        const latestKeys = {
            PK: createLatestPartitionKey(page),
            SK: createLatestSortKey(page)
        };

        const items = [
            entity.putBatch({
                ...page,
                ...revisionKeys,
                TYPE: createRevisionType()
            })
        ];
        if (latestPage.id === page.id) {
            items.push(
                entity.putBatch({
                    ...page,
                    ...latestKeys,
                    TYPE: createLatestType()
                })
            );
        }

        try {
            await batchWriteAll({
                table: entity.table,
                items
            });
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not request changes on page record.",
                ex.code || "REQUEST_CHANGES_ERROR",
                {
                    original,
                    page,
                    latestPage
                }
            );
        }
        return page;
    };

    /**
     * There are only few options to use when getting the page.
     * For that reason we try to have it as simple as possible when querying.
     */
    const get = async (params: PageStorageOperationsGetParams): Promise<Page | null> => {
        const { where } = params;
        const { pid, id, path, published } = where;
        let { version } = where;
        /**
         * In case of having full ID and not having version we can take the version from the id.
         */
        if (id && id.includes("#") && !version) {
            version = Number(id.split("#").pop());
        }
        let keys;
        if (path) {
            return getByPath({
                where: {
                    ...where,
                    path
                }
            });
        } else if (!id && !pid) {
            throw new WebinyError("There are no ID or pageId.", "MALFORMED_GET_REQUEST", {
                where
            });
        } else if (published) {
            keys = {
                PK: createPublishedPartitionKey(where),
                SK: createPublishedSortKey({
                    id: id || pid
                })
            };
        } else if (version) {
            keys = {
                PK: createRevisionPartitionKey({
                    ...where,
                    id: id || pid
                }),
                SK: createRevisionSortKey({
                    version
                })
            };
        } else {
            keys = {
                PK: createLatestPartitionKey(where),
                SK: createLatestSortKey({
                    id: id || pid
                })
            };
        }
        try {
            const result = await entityGet<Page>({
                entity,
                keys
            });
            if (!result) {
                return null;
            }
            return cleanupItem(entity, result);
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not load page by given params.",
                ex.code || "GET_PAGE_ERROR",
                {
                    where,
                    keys
                }
            );
        }
    };

    const getByPath = async (
        params: PageStorageOperationsGetByPathParams
    ): Promise<Page | null> => {
        const { where } = params;
        const pathKeys = {
            PK: createPathPartitionKey(where),
            SK: createPathSortKey(where)
        };

        const queryOptions: QueryAllParams = {
            entity,
            partitionKey: pathKeys.PK,
            options: {
                index: GSI1_INDEX,
                eq: pathKeys.SK
            }
        };
        try {
            const result = await queryOne<Page>(queryOptions);
            if (!result) {
                return null;
            }
            return cleanupItem(entity, result);
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not get page by given path.",
                ex.code || "GET_PAGE_BY_PATH_ERROR",
                {
                    params
                }
            );
        }
    };

    const list = async (
        params: PageStorageOperationsListParams
    ): Promise<PageStorageOperationsListResponse> => {
        const { where: initialWhere } = params;

        const { latest, published } = initialWhere;
        /**
         * We do not allow loading both published and latest at the same time.
         * @see PageStorageOperationsListWhere
         */
        if (published && latest) {
            throw new WebinyError(
                "Both published and latest cannot be defined at the same time.",
                "MALFORMED_WHERE_ERROR",
                {
                    where: params.where
                }
            );
        }

        const { limit: initialLimit, after: previousCursor } = params;

        const limit = initialLimit || 50;

        const options: QueryAllParams["options"] = {
            gte: " "
        };

        const { tags_in: tags, tags_rule: tagsRule, search } = initialWhere;

        const where: any = {
            ...initialWhere
        };
        delete where.search;
        delete where.tags_in;
        delete where.tags_rule;
        delete where.tenant;
        delete where.locale;
        delete where.latest;
        delete where.published;
        if (tags && tags.length > 0) {
            if (tagsRule === "any") {
                where.tags_in = tags;
            } else {
                where.tags_and_in = tags;
            }
        }
        if (search) {
            /**
             * We need to pass fuzzy into where so we need to cast it as where because it does not exist on the original type
             */
            where.fuzzy = {
                fields: ["title", "snippet"],
                value: search
            };
        }

        let partitionKey: string;
        if (published) {
            partitionKey = createPublishedPartitionKey(initialWhere);
            //
            where.listPublished_not = false;
        } else {
            partitionKey = createLatestPartitionKey(initialWhere);
            where.listLatest_not = false;
        }

        const queryAllParams: QueryAllParams = {
            entity,
            partitionKey,
            options
        };

        let dbRecords: Page[] = [];
        try {
            dbRecords = await queryAll(queryAllParams);
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not load pages by given query params.",
                ex.code || "LIST_PAGES_ERROR",
                {
                    partitionKey,
                    options
                }
            );
        }

        const fields = plugins.byType<PageDynamoDbFieldPlugin>(PageDynamoDbFieldPlugin.type);

        const filteredPages = filterItems<Page>({
            items: dbRecords,
            plugins,
            where,
            fields
        }).map(item => {
            return cleanupItem<Page>(entity, item);
        });

        const sortedPages = sortItems<Page>({
            items: filteredPages,
            sort: params.sort,
            fields
        });

        const totalCount = sortedPages.length;

        const start = decodeCursor(previousCursor) || 0;
        const hasMoreItems = totalCount > start + limit;
        const end = limit > totalCount + start + limit ? undefined : start + limit;
        const pages = sortedPages.slice(start, end);
        /**
         * Although we do not need a cursor here, we will use it as such to keep it standardized.
         * Number is simply encoded.
         */
        const cursor = pages.length > 0 ? encodeCursor(start + limit) : null;

        const meta = {
            hasMoreItems,
            totalCount,
            cursor
        };

        return {
            items: pages,
            meta
        };
    };

    /**
     * Listing of the revisions will be done through the DynamoDB since there are no revisions saved in the Elasticsearch.
     */
    const listRevisions = async (
        params: PageStorageOperationsListRevisionsParams
    ): Promise<Page[]> => {
        const { where } = params;
        const queryAllParams: QueryAllParams = {
            entity,
            partitionKey: createRevisionPartitionKey({
                ...where,
                id: where.pid
            }),
            options: {
                gte: " ",
                reverse: false
            }
        };

        try {
            return await queryAll(queryAllParams);
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not load all the revisions from requested page.",
                ex.code || "LOAD_PAGE_REVISIONS_ERROR",
                {
                    params
                }
            );
        }
    };

    const listTags = async (params: PageStorageOperationsListTagsParams): Promise<string[]> => {
        const { where } = params;

        const options: QueryAllParams["options"] = {
            gte: " "
        };

        const partitionKey = createLatestPartitionKey(where);

        const queryAllParams: QueryAllParams = {
            entity,
            partitionKey,
            options
        };

        let pages: DbItem<Page>[] = [];
        try {
            pages = await queryAll<Page>(queryAllParams);
        } catch (ex) {
            throw new WebinyError(
                ex.message || "Could not load pages by given query params.",
                ex.code || "LIST_PAGES_TAGS_ERROR",
                {
                    partitionKey,
                    options
                }
            );
        }

        const tags = pages.reduce((collection, page) => {
            let list = lodashGet(page, "settings.general.tags");
            if (!list || list.length === 0) {
                return collection;
            } else if (where.search) {
                const re = new RegExp(where.search, "i");
                list = list.filter(t => t.match(re) !== null);
            }

            for (const t of list) {
                collection[t] = undefined;
            }
            return collection;
        }, {});

        return Object.keys(tags);
    };

    return {
        get,
        create,
        update,
        delete: deleteOne,
        deleteAll,
        createFrom,
        list,
        listRevisions,
        publish,
        requestChanges,
        requestReview,
        unpublish,
        listTags
    };
};
