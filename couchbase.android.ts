import * as  utils from "utils/utils";
//import fs = require("file-system");

declare var com: any;
declare var java: any;
declare var android: any;

function mapToJson(data: Object) {
    var gson = (new com.google.gson.GsonBuilder()).create();
    return gson.toJson(data);
}

function objectToMap(data: Object) {
    var gson = (new com.google.gson.GsonBuilder()).create();
    return gson.fromJson(JSON.stringify(data), (new java.util.HashMap).getClass());
}

function mapToObject(data: Object) {
    var gson = (new com.google.gson.GsonBuilder()).create();
    return JSON.parse(gson.toJson(data));
}

export enum ReplicationStatus {
    Stopped = 0,
    Offline,
    Idle,
    Active,
}

export class Couchbase {

    private context: any;
    private manager: any;
    private database: any;

    public constructor(databaseName: string) {
        this.context = utils.ad.getApplicationContext();
        try {
            this.manager = new com.couchbase.lite.Manager(new com.couchbase.lite.android.AndroidContext(this.context), null);
            this.database = this.manager.getDatabase(databaseName);
        } catch (exception) {
            console.error("MANAGER ERROR:", exception.message);
            throw new Error("MANAGER ERROR: " + exception.message);
        }
    }

    public createDocument(data: Object, documentId?: string) {
        var document: any = documentId == null ? this.database.createDocument() : this.database.getDocument(documentId);
        var documentId: string = document.getId();
        try {
            document.putProperties(objectToMap(data));
        } catch (exception) {
            console.error("DOCUMENT ERROR:", exception.message);
            throw new Error("DOCUMENT ERROR: " + exception.message);
        }
        return documentId;
    }

    public getDocument(documentId: string) {
        var document: any = this.database.getDocument(documentId);
        return JSON.parse(mapToJson(document.getProperties()));
    }

    public updateDocument(documentId: string, data: any) {
        let document: any = this.database.getDocument(documentId);
        let temp: any = JSON.parse(mapToJson(document.getProperties()));
        data._id = temp._id;
        data._rev = temp._rev;
        try {
            document.putProperties(objectToMap(data));
        } catch (exception) {
            console.error("DOCUMENT ERROR", exception.message);
            throw new Error("DOCUMENT ERROR: " + exception.message);
        }
    }

    public deleteDocument(documentId: string) {
        var document: any = this.database.getDocument(documentId);
        try {
            document.delete();
        } catch (exception) {
            console.error("DOCUMENT ERROR", exception.message);
        }
        return document.isDeleted();
    }

    public destroyDatabase() {
        try {
            this.database.delete();
        } catch (exception) {
            console.error("DESTROY", exception.message);
        }
    }

    public createView(viewName: string, viewRevision: string, callback: any) {
        var view = this.database.getView(viewName);
        var self = this;
        view.setMap(new com.couchbase.lite.Mapper({
            map(document, emitter) {
                let e = new Emitter(emitter);
                callback(JSON.parse(mapToJson(document)), e);
            }
        }), viewRevision);
    }

    public executeQuery(viewName: string, options?: any) {
        var query = this.database.getView(viewName).createQuery();
        if (options != null) {
            if (options.descending) {
                query.setDescending(options.descending);
            }
            if (options.limit) {
                query.setLimit(options.limit);
            }
            if (options.skip) {
                query.setSkip(options.skip);
            }
            if (options.startKey) {
                query.setStartKey(options.startKey);
            }
            if (options.endKey) {
                query.setEndKey(options.endKey);
            }
        }
        var result = query.run();
        var parsedResult: Array<any> = [];
        while (result.hasNext()) {
            var row = result.next();
            parsedResult.push(mapToObject(row.getValue()));
        }
        return parsedResult;
    }

    public createPullReplication(remoteUrl: string) {
        var replication;
        try {
            replication = this.database.createPullReplication(new java.net.URL(remoteUrl));
        } catch (exception) {
            console.error("PULL ERROR", exception.message);
            throw new Error("PULL ERROR: " + exception.message);
        }
        return new Replicator(replication);
    }

    public createPushReplication(remoteUrl: string) {
        var replication;
        try {
            replication = this.database.createPushReplication(new java.net.URL(remoteUrl));
        } catch (exception) {
            console.error("PUSH ERROR", exception.message);
            throw new Error("PUSH ERROR: " + exception.message);
        }
        return new Replicator(replication);
    }

    public addDatabaseChangeListener(callback: any) {
        try {
            const listener = new com.couchbase.lite.Database.ChangeListener({
                changed(event) {
                    let changes: Array<any> = event.getChanges().toArray();
                    callback(changes);
                }
            });

            this.database.addChangeListener(listener);
            return listener;
        } catch (exception) {
            console.error("DATABASE LISTENER ERROR", exception.message);
        }
    }

    public removeDatabaseChangeListener(listener: any) {
        try {
            this.database.removeChangeListener(listener);
        } catch (exception) {
            console.error("DATABASE LISTENER REMOVAL ERROR", exception.message);
        }
    }

    public addDatabaseConflictsListener(
        conflictsCallback: (documentId: string, conflictingRevisions: SavedRevision[]) => UnsavedRevision[],
        successCallback: (documentId: string) => void,
        errorCallback: (documentId: string, error: any) => any
    ): any {
        const database = this.database;

        const conflictsLiveQuery = database.createAllDocumentsQuery().toLiveQuery();
        conflictsLiveQuery.setAllDocsMode(com.couchbase.lite.Query.AllDocsMode.ONLY_CONFLICTS);

        try {
            const listener = new DatabaseConflictsChangeListener(
                this.database,
                conflictsLiveQuery,
                conflictsCallback,
                successCallback,
                errorCallback);

            conflictsLiveQuery.addChangeListener(listener);
            conflictsLiveQuery.start();

            return listener;
        } catch (e) {
            console.log(e);
            return null;
        }
    }

    private removeDatabaseConflictsListener(listener: any) {
        try {
            const conflictsLiveQuery = listener.getConflictsLiveQuery();

            conflictsLiveQuery.removeChangeListener(listener);
            conflictsLiveQuery.stop();
        } catch (exception) {
            console.error("DATABASE CONFLICTS LISTENER REMOVAL ERROR", exception.message);
        }
    }

    /*private getPath(uri) {
        let cursor = applicationModule.android.currentContext.getContentResolver().query(uri, null, null, null, null);
        if (cursor == null) return null;
        let column_index = cursor.getColumnIndexOrThrow(android.provider.MediaStore.MediaColumns.DATA);
        cursor.moveToFirst();
        let s = cursor.getString(column_index);
        cursor.close();
        return s;
    }

    getAttachment(documentId: string, attachmentId: string): Promise<any> {
        return new Promise((resolve, reject) => {
            let document = this.database.getDocument(documentId);
            let rev = document.getCurrentRevision();
            let att = rev.getAttachment(attachmentId);
            if (att != null) {
                resolve(att.getContent());
            } else {
                reject("Sorry can't process your request");
            }
        })
    }

    setAttachment(documentId: string, attachmentId: string, file: string): Promise<any> {
        return new Promise((resolve, reject) => {
            let document = this.database.getDocument(documentId);
            let newRev = document.getCurrentRevision().createRevision();
            if (file.toString().substr(0, 10).indexOf('content://') > -1) {
                let stream = applicationModule.android.context.getContentResolver().openInputStream(file);
                let fileExtension = android.webkit.MimeTypeMap.getFileExtensionFromUrl(this.getPath(file));
                let mimeType = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(fileExtension);
                try {
                    newRev.setAttachment(attachmentId, mimeType, stream);
                    newRev.save();
                    resolve();
                } catch (exception) {
                    reject(exception.message);
                }

            } else if (file.toString().substr(0, 7).indexOf('file://') > -1) {
                let stream = applicationModule.android.context.getContentResolver().openInputStream(android.net.Uri.fromFile(file));
                let fileExtension = android.webkit.MimeTypeMap.getFileExtensionFromUrl(file);
                let mimeType = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(fileExtension);
                try {
                    newRev.setAttachment(attachmentId, mimeType, stream);
                    newRev.save();
                    resolve();
                } catch (exception) {
                    reject(exception.message);
                }
            } else if (file.substr(0, 2).indexOf('~/') > -1) {
                let path = fs.path.join(fs.knownFolders.currentApp().path, file.replace('~/', ''));
                let stream = applicationModule.android.context.getContentResolver().openInputStream(android.net.Uri.fromFile(new java.io.File(path)));
                let fileExtension = android.webkit.MimeTypeMap.getFileExtensionFromUrl(path);
                let mimeType = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(fileExtension);
                try {
                    newRev.setAttachment(attachmentId, mimeType, stream);
                    newRev.save();
                    resolve();
                } catch (exception) {
                    reject(exception.message);
                }
            }
        })
    }

    removeAttachment(documentId: string, attachmentId: string): Promise<any> {
        return new Promise((resolve, reject) => {
            let document = this.database.getDocument(documentId);
            let newRev = document.getCurrentRevision().createRevision();
            try {
                newRev.removeAttachment(attachmentId);
                newRev.save();
                resolve();
            } catch (exception) {
                reject(exception.message);
            }

        })
    }*/

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
        return this.replicator.isRunning;
    }

    setContinuous(isContinuous: boolean) {
        this.replicator.setContinuous(isContinuous);
    }

    setCookie(name: String, value: String, path: String, expirationDate: Date, secure: boolean, httpOnly: boolean) {
        let date = new java.util.Date(expirationDate.getTime());
        this.replicator.setCookie(name, value, path, date, secure, httpOnly);
    };

    deleteCookie(name: String) {
        this.replicator.deleteCookieNamed(name);
    }

    setAuthenticator(authenticator: any) {
        this.replicator.setAuthenticator(authenticator);
    }

    addReplicationChangeListener(callback: (replicationStatus: ReplicationStatus) => void): any {
        try {
            const listener = new com.couchbase.lite.replicator.Replication.ChangeListener({
                changed(event) {
                    // https://github.com/couchbase/couchbase-lite-java-core/blob/0a991a6f132d4d262cd84e32c5f01a9a6ea03468/src/main/java/com/couchbase/lite/replicator/Replication.java#L591
                    const status = event.getSource().getStatus();

                    switch (status) {
                        case com.couchbase.lite.replicator.Replication.ReplicationStatus.REPLICATION_STOPPED:
                            return callback(ReplicationStatus.Stopped);

                        case com.couchbase.lite.replicator.Replication.ReplicationStatus.REPLICATION_OFFLINE:
                            return callback(ReplicationStatus.Offline);

                        case com.couchbase.lite.replicator.Replication.ReplicationStatus.REPLICATION_ACTIVE:
                            return callback(ReplicationStatus.Active);

                        default:
                            return callback(ReplicationStatus.Idle);
                    }
                }
            });

            this.replicator.addChangeListener(listener);
            return listener;
        } catch (exception) {
            console.error("REPLICATION LISTENER ERROR", exception.message);
            return null;
        }
    }

    removeReplicationChangeListener(listener: any) {
        try {
            this.replicator.removeChangeListener(listener);
        } catch (exception) {
            console.error("REPLICATION LISTENER REMOVAL ERROR", exception.message);
        }
    }

    getLastError() {
        return this.replicator.getLastError();
    }

    getStatus() {
        return this.replicator.getStatus();
    }

}

export class Authenticator {
    static createBasicAuthenticator(username: string, password: string) {
        return com.couchbase.lite.auth.AuthenticatorFactory.createBasicAuthenticator(username, password);
    }
}

export abstract class Revision {

    protected revision: any;

    constructor(revision: any) {
        this.revision = revision;
    }

    getId() {
        return this.revision.getId();
    }

    getUserProperties() {
        return mapToObject(this.revision.getUserProperties());
    }

    getIsDeletion() {
        return this.revision.isDeletion();
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
        this.revision.setIsDeletion(value);
    }

    saveAllowingConflict() {
        this.revision.save(true);
    }
}

export class Emitter {

    public emitter: any;

    constructor(emitter: any) {
        this.emitter = emitter;
    }

    emit(key: Object, value: Object) {
        if (typeof value === "object") {
            var gson = (new com.google.gson.GsonBuilder()).create();
            this.emitter.emit(key, gson.fromJson(JSON.stringify(value), (new java.util.HashMap).getClass()));
        } else {
            this.emitter.emit(key, value);
        }
    }

}

@Interfaces([com.couchbase.lite.LiveQuery.ChangeListener])
class DatabaseConflictsChangeListener extends (java.lang.Object as { new(): any; }) {
    private database: any;
    
    private conflictsLiveQuery: any;

    private conflictsCallback: (documentId: string, conflictingRevisions: SavedRevision[]) => UnsavedRevision[];
    
    private successCallback: (documentId: string) => void;

    private errorCallback: (documentId: string, error: any) => void;

    constructor(
        database: any,
        conflictsLiveQuery: any,
        conflictsCallback: (documentId: string, conflictingRevisions: SavedRevision[]) => UnsavedRevision[],
        successCallback: (documentId: string) => void,
        errorCallback: (documentId: string, error: any) => any
    ) {
        super();

        this.database = database;
        this.conflictsLiveQuery = conflictsLiveQuery;
        this.conflictsCallback = conflictsCallback;
        this.successCallback = successCallback;
        this.errorCallback = errorCallback;

        return global.__native(this);
    }

    public getDatabase() {
        return this.database;
    }

    public getConflictsLiveQuery() {
        return this.conflictsLiveQuery;
    }

    public changed(event) {
        this.resolveConflicts();
    }

    private resolveConflicts() {
        const rows = this.conflictsLiveQuery.getRows();
        let row = rows.next();

        while (row) {
            const documentId = row.getDocumentId();
            const conflictingRevisions = row.getConflictingRevisions();

            if (!conflictingRevisions || conflictingRevisions.size() === 1) {
                row = rows.next();
                continue;
            }

            const savedConflictingRevisions = [];

            for (let i = 0; i < conflictingRevisions.size(); i++) {
                savedConflictingRevisions.push(new SavedRevision(conflictingRevisions.get(i)));
            }

            const resolvedRevisions = this.conflictsCallback(documentId, savedConflictingRevisions);

            const successCallback = this.successCallback;
            const errorCallback = this.errorCallback;

            this.database.runInTransaction(new com.couchbase.lite.TransactionalTask({
                run(): boolean {
                    try {
                        resolvedRevisions.forEach(rr => rr.saveAllowingConflict());
                        successCallback(documentId);
                        return true;
                    } catch (e) {
                        console.error(e);
                        errorCallback(documentId, e);
                        return false;
                    }
                }
            }));

            row = rows.next();
        }
    }
}
