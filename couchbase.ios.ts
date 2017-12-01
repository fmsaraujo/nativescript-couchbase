declare var CBLManager: any;
declare var interop: any;
declare var NSURL: any;
declare var NSNotificationCenter: any;
declare var NSOperationQueue: any;
declare var NSJSONSerialization: any;
declare var NSString: any;
declare var NSJSONWritingPrettyPrinted: any;
declare var NSUTF8StringEncoding: any;
declare var CBLAuthenticator: any;
declare var CBLAllDocsMode: any;

function getter<T>(_this: any, property: T | { (): T }): T {
    if (typeof property === "function") {
        return (<{ (): T }>property).call(_this);
    } else {
        return <T>property;
    }
}

function mapToJson(properties: Object) {
    var errorRef = new interop.Reference();
    var result = "";
    if (NSJSONSerialization.isValidJSONObject(properties)) {
        var data = NSJSONSerialization.dataWithJSONObjectOptionsError(properties, NSJSONWritingPrettyPrinted, errorRef);
        result = NSString.alloc().initWithDataEncoding(data, NSUTF8StringEncoding);
    } else {
        result = JSON.stringify(properties);
    }
    return result;
}

export enum ReplicationStatus {
    Stopped = 0,
    Offline,
    Idle,
    Active,
}

export class Couchbase {

    private manager: any;
    private database: any;
    private databaseChangeObserver: any;

    constructor(databaseName: String) {
        this.manager = CBLManager.sharedInstance();
        if (!this.manager) {
            console.log("MANAGER ERROR:Can not create share instance of CBLManager");
            throw new Error("MANAGER ERROR:Can not create share instance of CBLManager");
        }
        var errorRef = new interop.Reference();

        this.database = this.manager.databaseNamedError(databaseName, errorRef);

        if (!this.database) {
            console.log(errorRef.value);
            throw new Error(errorRef.value);
        }
    }

    createDocument(data: Object, documentId?: string) {
        var doc = documentId == null ? this.database.createDocument() : this.database.documentWithID(documentId);

        var documentId: string = doc.documentID;

        var errorRef = new interop.Reference();
        var revision = doc.putPropertiesError(data, errorRef);

        if (!errorRef) {
            console.log("DOCUMENT ERROR:" + errorRef.value);
            throw new Error("DOCUMENT ERROR:" + errorRef.value);
        }

        return documentId;
    }

    getDocument(documentId: string) {
        var document = this.database.documentWithID(documentId);

        if (document && document.properties) {
            return JSON.parse(mapToJson(document.properties));
        }
        return null;
    }

    getDocumentLatestRevisionId(documentId: string): string {
        var document = this.database.documentWithID(documentId);
        
        if (document) {
            return document.currentRevisionID;
        }

        return null;
    }

    updateDocument(documentId: string, data: any) {
        var document = this.database.documentWithID(documentId);
        let temp: any = this.getDocument(documentId);
        data._id = temp._id;
        data._rev = temp._rev;
        var errorRef = new interop.Reference();
        var revision = document.putPropertiesError(data, errorRef);

        if (!errorRef) {
            console.error("DOCUMENT ERROR", errorRef.value);
            throw new Error("DOCUMENT ERROR " + errorRef.value);
        }
    }

    deleteDocument(documentId: string) {
        var document = this.database.documentWithID(documentId);
        var errorRef = new interop.Reference();

        document.deleteDocument(errorRef);

        if (!errorRef) {
            return false;
        }
        return true;
    }

    createView(viewName: string, viewRevision: string, callback: any) {
        var self = this;
        var view = this.database.viewNamed(viewName)
        view.setMapBlockVersion(function (document, emit) {
            callback(JSON.parse(mapToJson(document)), {
                emit: emit
            });
        }, viewRevision);
    }

    executeQuery(viewName: string, options?: any): Array<any> {
        var view = this.database.viewNamed(viewName);
        var query = view.createQuery();
        if (options != null) {
            if (options.descending) {
                query.descending = options.descending;
            }
            if (options.limit) {
                query.limit = options.limit;
            }
            if (options.skip) {
                query.skip = options.skip;
            }
            if (options.startKey) {
                query.startKey = options.startKey;
            }
            if (options.endKey) {
                query.endKey = options.endKey;
            }
        }
        var errorRef = new interop.Reference();
        var resultSet = query.run(errorRef);

        var row = resultSet.nextRow();

        var results: Array<any> = [];

        while (row) {
            if (row.value !== null) {
                if (typeof row.value === "object") {
                    results.push(JSON.parse(mapToJson(row.value)));
                } else {
                    results.push(row.value);
                }
            }
            row = resultSet.nextRow();
        }

        if (!errorRef) {
            console.log(errorRef.value);
        }

        return results;
    }

    createPullReplication(remoteUrl: string) {
        var url = NSURL.URLWithString(remoteUrl);

        var replication = this.database.createPullReplication(url);

        if (!replication) {
            console.error("PULL ERROR");
            throw new Error("PULL ERROR");
        }

        return new Replicator(replication);
    }

    createPushReplication(remoteUrl: string) {
        var url = NSURL.URLWithString(remoteUrl);

        var replication = this.database.createPushReplication(url);

        if (!replication) {
            console.error("PUSH ERROR");
            throw new Error("PUSH ERROR");
        }

        return new Replicator(replication);;
    }

    addDatabaseChangeListener(callback: (changes: DatabaseChange[]) => void): any {
        const defaultCenter = getter(NSNotificationCenter, NSNotificationCenter.defaultCenter);
        const mainQueue = getter(NSOperationQueue, NSOperationQueue.mainQueue);

        return defaultCenter.addObserverForNameObjectQueueUsingBlock(`CBLDatabaseChange`, this.database, mainQueue, function (notification) {
            const changesList = [];
            if (notification.userInfo) {
                const changes = notification.userInfo.objectForKey("changes");

                if (changes != null) {
                    for (let i = 0; i < changes.count; i++) {
                        changesList.push(new DatabaseChange(changes[i]));
                    }
                    callback(changesList);
                }
            }
        });
    }

    removeDatabaseChangeListener(listener: any) {
        const defaultCenter = getter(NSNotificationCenter, NSNotificationCenter.defaultCenter);
        defaultCenter.removeObserver(listener);
    }

    addDatabaseConflictsListener(
        conflictsCallback: (documentId: string, conflictingRevisions: SavedRevision[]) => UnsavedRevision[],
        successCallback: (documentId: string) => void,
        errorCallback: (documentId: string, error: any) => any
    ): any {
        const conflictsLiveQuery = this.database.createAllDocumentsQuery().asLiveQuery();
        conflictsLiveQuery.allDocsMode = CBLAllDocsMode.kCBLOnlyConflicts;

        try {
            const observer = (DatabaseConflictsObserver.alloc() as DatabaseConflictsObserver);

            observer.initWithDatabaseConflictsLiveQueryConflictsCallbackSuccessCallbackErrorCallback(
                this.database,
                conflictsLiveQuery,
                conflictsCallback,
                successCallback,
                errorCallback);

            conflictsLiveQuery.addObserverForKeyPathOptionsContext(observer, 'rows', NSKeyValueObservingOptions.New, null);
            conflictsLiveQuery.start();

            return observer;
        } catch (e) {
            console.log(e);
            return null;
        }
    }

    removeDatabaseConflictsListener(listener: any) {
        const conflictsLiveQuery = (listener as DatabaseConflictsObserver).getConflictsLiveQuery();
        
        conflictsLiveQuery.removeObserverForKeyPath(listener, 'rows');
        conflictsLiveQuery.stop();
    }

    destroyDatabase() {
        var errorRef = new interop.Reference();

        this.database.deleteDatabase(errorRef);

        if (!errorRef) {
            console.error("DESTROY", errorRef.value);
        }
    }
}

export class Replicator {

    replicator: any;

    constructor(replicator: any) {
        this.replicator = replicator;
    }

    start() {
        this.replicator.start();
    }

    stop() {
        this.replicator.stop();
    }

    isRunning() {
        this.replicator.isRunning;
    }

    setContinuous(isContinuous: boolean) {
        this.replicator.continuous = isContinuous;
    }

    setCookie(name: String, value: String, path: String, expirationDate: Date, secure: boolean) {
        this.replicator.setCookieNamedWithValuePathExpirationDateSecure(name, value, path, expirationDate, secure);
    };

    deleteCookie(name: String) {
        this.replicator.deleteCookieNamed(name);
    }

    setAuthenticator(authenticator: any) {
        this.replicator.authenticator = authenticator;
    }

    addReplicationChangeListener(callback: (replicationStatus: ReplicationStatus) => void) {
        let defaultCenter = getter(NSNotificationCenter, NSNotificationCenter.defaultCenter)
        let mainQueue = getter(NSOperationQueue, NSOperationQueue.mainQueue)

        return defaultCenter.addObserverForNameObjectQueueUsingBlock(
            'CBLReplicationChange',
            this.replicator,
            mainQueue,
            function (notification) {
                callback(notification.object.status as ReplicationStatus);
            });
    }

    removeReplicationChangeListener(listener: any) {
        let defaultCenter = getter(NSNotificationCenter, NSNotificationCenter.defaultCenter);
        defaultCenter.removeObserver(listener);
    }

    getLastError() {
        return this.replicator.lastError;
    }

    getStatus() {
        return this.replicator.status;
    }
}

export class Authenticator {
    static createBasicAuthenticator(username: string, password: string) {
        return CBLAuthenticator.basicAuthenticatorWithNamePassword(username, password);
    }
}

export class DatabaseChange {

    change: any;

    constructor(change: any) {
        this.change = change;
    }

    getDocumentId() {
        return this.change.documentID;
    }

    getRevisionId() {
        return this.change.revisionID;
    }

    getSourceURL() {
        const source = this.change.source;

        if (source) {
            return source.absoluteURL;
        }

        return null;
    }

    isCurrentRevision() {
        return this.change.isCurrentRevision;
    }

    isConflict() {
        return this.change.inConflict;
    }

    isDeletion() {
        return this.change.isDeletion;
    }
}

export abstract class Revision {

    protected revision: any;

    constructor(revision: any) {
        this.revision = revision;
    }

    getId() {
        return this.revision.revisionID;
    }

    getUserProperties() {
        return JSON.parse(mapToJson(this.revision.userProperties));
    }

    getIsDeletion() {
        return this.revision.isDeletion;
    }
}

export class SavedRevision extends Revision {

    constructor(revision: any) {
        super(revision);
    }

    createRevision() {
        const unsavedRevision = this.revision.createRevision();
        return new UnsavedRevision(unsavedRevision);
    }
}

export class UnsavedRevision extends Revision {

    constructor(revision: any) {
        super(revision);
    }

    setIsDeletion(value: boolean) {
        this.revision.isDeletion = value;
    }

    saveAllowingConflict() {
        var errorRef = new interop.Reference();
        this.revision.saveAllowingConflict(errorRef);

        if (!errorRef) {
            throw new Error(errorRef.value);
        }
    }
}

class DatabaseConflictsObserver extends NSObject {

    private database: any;

    private conflictsLiveQuery: any;

    private conflictsCallback: (documentId: string, conflictingRevisions: SavedRevision[]) => UnsavedRevision[];

    private successCallback: (documentId: string) => void;

    private errorCallback: (documentId: string, error: any) => void;

    initWithDatabaseConflictsLiveQueryConflictsCallbackSuccessCallbackErrorCallback(
        database: any,
        conflictsLiveQuery: any,
        conflictsCallback: (documentId: string, conflictingRevisions: SavedRevision[]) => UnsavedRevision[],
        successCallback: (documentId: string) => void,
        errorCallback: (documentId: string, error: any) => void
    ) {
        const self = super.init();

        if (self) {
            self.database = database;
            self.conflictsLiveQuery = conflictsLiveQuery;
            self.conflictsCallback = conflictsCallback;
            self.successCallback = successCallback;
            self.errorCallback = errorCallback;
        }
    }

    observeValueForKeyPathOfObjectChangeContext(keyPath: string, object?: any, change?: any, context?: any) {
        if (object !== this.conflictsLiveQuery) {
            return;
        }

        this.resolveConflicts();
    }

    getDatabase() {
        return this.database;
    }

    getConflictsLiveQuery() {
        return this.conflictsLiveQuery;
    }

    private resolveConflicts() {
        const rows = this.conflictsLiveQuery.rows;
        let row = rows.nextRow();

        while (row) {
            const documentId = row.documentID;
            const conflictingRevisions = row.conflictingRevisions;

            if (!conflictingRevisions || conflictingRevisions.count === 1) {
                row = rows.nextRow();
                continue;
            }

            const savedConflictingRevisions = [];

            for (let i = 0; i < conflictingRevisions.count; i++) {
                savedConflictingRevisions.push(new SavedRevision(conflictingRevisions[i]));
            }

            const resolvedRevisions = this.conflictsCallback(documentId, savedConflictingRevisions);

            this.database.inTransaction(() => {
                try {
                    resolvedRevisions.forEach(rr => rr.saveAllowingConflict());

                    this.successCallback(documentId);
                    return true;
                } catch (e) {
                    console.error(e);
                    this.errorCallback(documentId, e);
                    return false;
                }
            });

            row = rows.nextRow();
        }
    }
}
