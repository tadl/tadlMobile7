# UserAPI Holds/Checkouts Request And Response Shapes

Generated from live TADLAspen/Aspen proxy calls on 2026-04-21T21:41:49.571Z.

Credentials are intentionally redacted. The live run used the appletest test account.

## Scope

These are the current mobile-facing `/API/UserAPI` shapes for hold and checkout functions that may move behind TADLHelper. Reading history, fines, preferences, search, featured items, and lists are intentionally out of scope for this migration reference.

## Notes From This Run

- Test account profile id: 826
- Initial checkout count: 0
- Initial hold count: 0
- Temporary hold target: Dogtown / recordId 48485193 / groupedWork 140b5425-a0ad-3c46-ecde-bb7a294b2dfa-eng
- Temporary hold cleanup: attempted and followed by a final hold refresh
- The test account had no checkouts, so `getPatronCheckedOutItems` captured the empty-list shape and `renewItem` captured the no-checkout error shape. Aspen's documented checkout item shape is included below as a non-live reference for mapper work.
- The mobile app's "renew all" behavior currently serializes multiple `renewItem` calls; it does not depend on a separate `renewAllCheckouts` route.

## Checkout Item Shape Reference

The live test account had no checked out items. Aspen's `UserAPI#getPatronCheckedOutItems` source documents checked-out items with this shape inside `result.checkedOutItems[]`:

```json
{
  "id": "966379",
  "itemId": "33025021368319",
  "dueDate": "01/24/2012",
  "checkoutDate": "2011-12-27 00:00:00",
  "barcode": "33025021368319",
  "renewCount": "1",
  "request": null,
  "overdue": false,
  "daysUntilDue": 16,
  "title": "Be iron fit : time-efficient training secrets for ultimate fitness /",
  "sortTitle": "be iron fit : time-efficient training secrets for ultimate fitness / time-efficient training secrets for ultimate fitness /",
  "author": "Fink, Don.",
  "format": "Book",
  "isbn": "9781599218571",
  "upc": "",
  "format_category": "Books",
  "holdQueueLength": 3
}
```

## Calls
### getPatronProfile

HTTP status: 200
Elapsed: 1140ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "getPatronProfile",
    "linkedUsers": "true",
    "checkIfValid": "false"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, profile: { deleteOnSave: null, id: number, source: string, username: string, unique_ils_id: string, cat_username: string, cat_password: string, ils_barcode: string, ils_username: string, ils_password: string, displayName: string, password: string, firstname: string, lastname: string, email: string, phone: string, patronType: string, created: string, homeLocationId: number, myLocation1Id: number, myLocation2Id: number, trackReadingHistory: string, initialReadingHistoryLoaded: number, lastReadingHistoryUpdate: number, bypassAutoLogout: number, disableRecommendations: number, disableCoverArt: number, overdriveEmail: string, promptForOverdriveEmail: number, hooplaCheckOutConfirmation: number, hooplaHoldQueueSizeConfirmation: number, promptForAxis360Email: number, axis360Email: string, preferredLibraryInterface: null, preferredTheme: number, noPromptForUserReviews: number, lockedFacets: null, alternateLibraryCard: string, alternateLibraryCardPassword: string, hideResearchStarters: number, disableAccountLinking: number, disableCirculationActions: number, oAuthAccessToken: null, oAuthRefreshToken: null, isLoggedInViaSSO: number, userCookiePreferenceEssential: number, userCookiePreferenceAnalytics: number, userCookiePreferenceLocalAnalytics: number, holdInfoLastLoaded: number, checkoutInfoLastLoaded: number, optInToAllCampaignLeaderboards: number, campaignNotificationsByEmail: number, onboardAppNotifications: number, shouldAskBrightness: number, interfaceLanguage: string, searchPreferenceLanguage: number, rememberHoldPickupLocation: number, pickupLocationId: number, pickupSublocationId: number, lastListUsed: number, browseAddToHome: number, lastLoginValidation: number, twoFactorStatus: number, updateMessage: null, updateMessageIsError: null, proPayPayerAccountId: null, enableCostSavings: number, totalCostSavings: string, currentCostSavings: string, isLocalTestUser: number, fullname: string, preferredName: null, address1: null, address2: null, city: null, state: null, zip: null, workPhone: null, mobileNumber: null, web_note: null, expires: string, expired: number, expireClose: number, isBlockedFromIllRequests: null, fines: string, finesVal: number, homeLibrary: null, homeLocationCode: null, homeLocation: null, myLocation1: null, myLocation2: null, numCheckedOutIls: number, numHoldsIls: number, numHoldsAvailableIls: number, numHoldsRequestedIls: number, notices: null, billingNotices: null, noticePreferenceLabel: null, dateOfBirth: null, emailReceiptFlag: null, availableHoldNotice: null, comingDueNotice: null, phoneType: null, materialsRequestEmailSignature: null, materialsRequestReplyToAddress: null, materialsRequestSendEmailOnAssign: number, numOverdue: number, readingHistoryEnabled: number, numReadingHistory: number, paymentHistoryEnabled: number, addLinkedAccountRule: number, removeLinkedAccountRule: number, numLinkedAccounts: number, numLinkedUsers: number, numLinkedViewers: number, isValidForOverdrive: boolean, isValidForHoopla: boolean, isValidForCloudLibrary: boolean, isValidForAxis360: boolean, isValidForPalaceProject: boolean, hasInterlibraryLoan: boolean, numCheckedOut: number, numHolds: number, numHoldsAvailable: number, numLists: number, numSavedSearches: number, numSavedSearchesNew: number, notification_preferences: Array<Object>, promptForHoldNotifications: boolean, holdNotificationInfo: Object, numSavedEvents: number, numSavedEventsUpcoming: number, summaryFines: string, canSuggestMaterials: number, isStaff: boolean, hasYearInReview: boolean, yearInReviewName: null } } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "profile": {
      "deleteOnSave": null,
      "id": 826,
      "source": "ils",
      "username": "1015630",
      "unique_ils_id": "1015630",
      "cat_username": "91111001936462",
      "cat_password": "<redacted>",
      "ils_barcode": "91111001936462",
      "ils_username": "<username>",
      "ils_password": "<redacted>",
      "displayName": "APPLE T.",
      "password": "<redacted>",
      "firstname": "APPLE",
      "lastname": "TEST USER",
      "email": "tech@tadl.org",
      "phone": "",
      "patronType": "Patrons",
      "created": "2025-11-19 00:00:00",
      "homeLocationId": 7,
      "myLocation1Id": 7,
      "myLocation2Id": 3,
      "trackReadingHistory": "0",
      "initialReadingHistoryLoaded": 0,
      "lastReadingHistoryUpdate": 0,
      "bypassAutoLogout": 0,
      "disableRecommendations": 0,
      "disableCoverArt": 0,
      "overdriveEmail": "",
      "promptForOverdriveEmail": 1,
      "hooplaCheckOutConfirmation": 1,
      "hooplaHoldQueueSizeConfirmation": 1,
      "promptForAxis360Email": 1,
      "axis360Email": "",
      "preferredLibraryInterface": null,
      "preferredTheme": -1,
      "noPromptForUserReviews": 0,
      "lockedFacets": null,
      "alternateLibraryCard": "",
      "alternateLibraryCardPassword": "",
      "hideResearchStarters": 0,
      "disableAccountLinking": 0,
      "disableCirculationActions": 0,
      "oAuthAccessToken": null,
      "oAuthRefreshToken": null,
      "isLoggedInViaSSO": 0,
      "userCookiePreferenceEssential": 0,
      "userCookiePreferenceAnalytics": 0,
      "userCookiePreferenceLocalAnalytics": 0,
      "holdInfoLastLoaded": 1776806986,
      "checkoutInfoLastLoaded": 1776806987,
      "optInToAllCampaignLeaderboards": 0,
      "campaignNotificationsByEmail": 0,
      "onboardAppNotifications": 1,
      "shouldAskBrightness": 1,
      "interfaceLanguage": "en",
      "searchPreferenceLanguage": -1,
      "rememberHoldPickupLocation": 0,
      "pickupLocationId": 5,
      "pickupSublocationId": 0,
      "lastListUsed": 536,
      "browseAddToHome": 1,
      "lastLoginValidation": 1776807069,
      "twoFactorStatus": 0,
      "updateMessage": null,
      "updateMessageIsError": null,
      "proPayPayerAccountId": null,
      "enableCostSavings": 0,
      "totalCostSavings": "0.00",
      "currentCostSavings": "0.00",
      "isLocalTestUser": 0,
      "fullname": "TEST USER,APPLE",
      "preferredName": null,
      "address1": null,
      "address2": null,
      "city": null,
      "state": null,
      "zip": null,
      "workPhone": null,
      "mobileNumber": null,
      "web_note": null,
      "expires": "Dec 3, 2027",
      "expired": 0,
      "expireClose": 0,
      "isBlockedFromIllRequests": null,
      "fines": "$0.00",
      "finesVal": 0,
      "homeLibrary": null,
      "homeLocationCode": null,
      "homeLocation": null,
      "myLocation1": null,
      "myLocation2": null,
      "numCheckedOutIls": 0,
      "numHoldsIls": 0,
      "numHoldsAvailableIls": 0,
      "numHoldsRequestedIls": 0,
      "notices": null,
      "billingNotices": null,
      "noticePreferenceLabel": null,
      "dateOfBirth": null,
      "emailReceiptFlag": null,
      "availableHoldNotice": null,
      "comingDueNotice": null,
      "phoneType": null,
      "materialsRequestEmailSignature": null,
      "materialsRequestReplyToAddress": null,
      "materialsRequestSendEmailOnAssign": 0,
      "numOverdue": 0,
      "readingHistoryEnabled": 1,
      "numReadingHistory": 0,
      "paymentHistoryEnabled": 0,
      "addLinkedAccountRule": 0,
      "removeLinkedAccountRule": 1,
      "numLinkedAccounts": 0,
      "numLinkedUsers": 0,
      "numLinkedViewers": 0,
      "isValidForOverdrive": false,
      "isValidForHoopla": false,
      "isValidForCloudLibrary": false,
      "isValidForAxis360": false,
      "isValidForPalaceProject": false,
      "hasInterlibraryLoan": false,
      "numCheckedOut": 0,
      "numHolds": 0,
      "numHoldsAvailable": 0,
      "numLists": 1,
      "numSavedSearches": 0,
      "numSavedSearchesNew": 0,
      "notification_preferences": [
        {
          "device": "Unknown",
          "token": "Unknown",
          "notifySavedSearch": 0,
          "notifyCustom": 0,
          "notifyAccount": 0,
          "onboardStatus": 1
        }
      ],
      "promptForHoldNotifications": true,
      "holdNotificationInfo": {
        "preferences": {
          "opac_hold_notify": {
            "name": "opac_hold_notify",
            "value": [
              "email|phone"
            ]
          },
          "opac_default_sms_carrier": {
            "name": "opac_default_sms_carrier",
            "value": null
          },
          "opac_default_sms_notify": {
            "name": "opac_default_sms_notify",
            "value": "231-932-8506"
          },
          "opac_default_phone": {
            "name": "opac_default_phone",
            "value": "231-932-8506"
          }
        },
        "primaryEmail": "tech@tadl.org",
        "smsCarriers": {
          "2": "Rogers Wireless(Canada & USA)",
          "3": "Rogers Wireless (Alternate)(Canada & USA)",
          "4": "Telus Mobility(Canada & USA)",
          "5": "Koodo Mobile(Canada)",
          "6": "Fido(Canada)",
          "7": "Bell Mobility & Solo Mobile(Canada)",
          "8": "Bell Mobility & Solo Mobile (Alternate)(Canada)",
          "9": "Aliant(Canada)",
          "10": "PC Telecom(Canada)",
          "11": "SaskTel(Canada)",
          "12": "MTS Mobility(Canada)",
          "13": "Virgin Mobile(Canada)",
          "14": "Iridium(International)",
          "15": "Globalstar(International)",
          "16": "Bulletin.net(International)",
          "17": "Panacea Mobile(International)",
          "18": "C Beyond(USA)",
          "19": "General Communications, Inc.(Alaska, USA)",
          "20": "Golden State Cellular(California, USA)",
          "21": "Cincinnati Bell(Cincinnati, Ohio, USA)",
          "22": "Hawaiian Telcom Wireless(Hawaii, USA)",
          "23": "i wireless (T-Mobile)(Midwest, USA)",
          "24": "i-wireless (Sprint PCS)(USA)",
          "25": "MetroPCS(USA)",
          "26": "Kajeet(USA)",
          "27": "Element Mobile(USA)",
          "28": "Esendex(USA)",
          "29": "Boost Mobile(USA)",
          "30": "BellSouth(USA)",
          "31": "Bluegrass Cellular(USA)",
          "32": "AT&T Enterprise Paging(USA)",
          "33": "AT&T Mobility/Wireless(USA)",
          "34": "AT&T Global Smart Messaging Suite(USA)",
          "35": "Alltel (Allied Wireless)(USA)",
          "36": "Alaska Communications(USA)",
          "37": "Ameritech(USA)",
          "38": "Cingular (GoPhone prepaid)(USA)",
          "39": "Cingular (Postpaid)(USA)",
          "40": "Cellular One (Dobson) / O2 / Orange(USA)",
          "41": "Cellular South(USA)",
          "42": "Cellcom(USA)",
          "43": "Chariton Valley Wireless(USA)",
          "44": "Cricket(USA)",
          "45": "Cleartalk Wireless(USA)",
          "46": "Edge Wireless(USA)",
          "47": "Syringa Wireless(USA)",
          "48": "T-Mobile(USA)",
          "49": "Straight Talk / PagePlus Cellular(USA)",
          "50": "South Central Communications(USA)",
          "51": "Simple Mobile(USA)",
          "52": "Sprint (PCS)(USA)",
          "53": "Nextel(USA)",
          "54": "Pioneer Cellular(USA)",
          "55": "Qwest Wireless(USA)",
          "56": "US Cellular(USA)",
          "57": "Unicel(USA)",
          "58": "Teleflip(USA)",
          "59": "Virgin Mobile(USA)",
          "60": "Verizon Wireless(USA)",
          "61": "USA Mobility(USA)",
          "62": "Viaero(USA)",
          "63": "TracFone(USA)",
          "64": "Centennial Wireless(USA)",
          "65": "Helio(South Korea and USA)"
        }
      },
      "numSavedEvents": 0,
      "numSavedEventsUpcoming": 0,
      "summaryFines": "Your accounts have $0.00 in fines",
      "canSuggestMaterials": 0,
      "isStaff": false,
      "hasYearInReview": false,
      "yearInReviewName": null
    }
  }
}
```

### getPatronCheckedOutItems

HTTP status: 200
Elapsed: 890ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "getPatronCheckedOutItems"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, checkedOutItems: Array<empty> } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "checkedOutItems": []
  }
}
```

### getPatronCheckedOutItems refreshCheckouts

HTTP status: 200
Elapsed: 1241ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "getPatronCheckedOutItems",
    "refreshCheckouts": "true"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, checkedOutItems: Array<empty> } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "checkedOutItems": []
  }
}
```

### getPatronHolds

HTTP status: 200
Elapsed: 1179ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "getPatronHolds"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, sortMethods: { unavailableSort: string, availableSort: string }, holds: { available: Array<empty>, unavailable: Array<empty> } } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "sortMethods": {
      "unavailableSort": "sortTitle",
      "availableSort": "expire"
    },
    "holds": {
      "available": [],
      "unavailable": []
    }
  }
}
```

### getPatronHolds refreshHolds

HTTP status: 200
Elapsed: 1197ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "getPatronHolds",
    "refreshHolds": "true"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, sortMethods: { unavailableSort: string, availableSort: string }, holds: { available: Array<empty>, unavailable: Array<empty> } } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "sortMethods": {
      "unavailableSort": "sortTitle",
      "availableSort": "expire"
    },
    "holds": {
      "available": [],
      "unavailable": []
    }
  }
}
```

### renewItem no-checkout error shape

HTTP status: 200
Elapsed: 534ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "renewItem",
    "itemSource": "ils",
    "itemBarcode": "0",
    "recordId": "0",
    "userId": 826
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, title: string, message: string } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": false,
    "title": "Checkout could not be renewed",
    "message": "\n\t\t\tSomeone attempted to retrieve a copy object from the\n\t\t\tsystem and the object was not found.\n\t\t"
  }
}
```

### placeHold test hold

HTTP status: 200
Elapsed: 2537ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "placeHold",
    "itemSource": "ils",
    "pickupBranch": "TADL-WOOD",
    "sublocation": "",
    "holdType": "item",
    "recordId": "48485193"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, title: string, message: string, action: null, confirmationNeeded: boolean, confirmationId: null, shouldBeItemHold: boolean, items: null, needsIllRequest: boolean } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "title": "Hold placed successfully",
    "message": "Your hold was placed successfully.",
    "action": null,
    "confirmationNeeded": false,
    "confirmationId": null,
    "shouldBeItemHold": false,
    "items": null,
    "needsIllRequest": false
  }
}
```

### getPatronHolds after placeHold

HTTP status: 200
Elapsed: 1212ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "getPatronHolds",
    "refreshHolds": "true"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, sortMethods: { unavailableSort: string, availableSort: string }, holds: { available: Array<empty>, unavailable: Object } } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "sortMethods": {
      "unavailableSort": "sortTitle",
      "availableSort": "expire"
    },
    "holds": {
      "available": [],
      "unavailable": {
        "ils3794408826": {
          "id": 3794408,
          "type": "ils",
          "source": "ils",
          "userId": 826,
          "sourceId": 3794408,
          "recordId": 48485193,
          "groupedWorkId": "140b5425-a0ad-3c46-ecde-bb7a294b2dfa-eng",
          "title": "Dogtown /",
          "author": "Applegate, Katherine,",
          "coverUrl": "https://discover.tadl.org/bookcover.php?id=ils:48485193&amp;size=medium&amp;isn=1250811600",
          "linkUrl": "/Record/48485193",
          "format": [
            "Book"
          ],
          "recordDriver": null,
          "user": "APPLE T. - All TADL Locations",
          "shortId": null,
          "itemId": null,
          "title2": null,
          "volume": null,
          "callNumber": null,
          "available": false,
          "cancelable": true,
          "cancelId": 3794408,
          "locationUpdateable": true,
          "pickupLocationId": "7",
          "pickupLocationName": "Woodmere (Main) Branch",
          "pickupSublocationId": null,
          "pickupSublocationName": null,
          "status": "Pending",
          "position": 1,
          "holdQueueLength": 1,
          "createDate": null,
          "availableDate": null,
          "expirationDate": null,
          "automaticCancellationDate": null,
          "frozen": false,
          "canFreeze": true,
          "reactivateDate": null,
          "isIll": false,
          "pendingCancellation": null,
          "outOfHoldGroupMessage": null,
          "collectionName": null,
          "cancellationUrl": null,
          "freezeError": null,
          "holdSource": "ILS",
          "ratingData": {
            "average": 0,
            "count": 0,
            "user": false,
            "num1star": 0,
            "num2star": 0,
            "num3star": 0,
            "num4star": 0,
            "num5star": 0,
            "barWidth5Star": 0,
            "barWidth4Star": 0,
            "barWidth3Star": 0,
            "barWidth2Star": 0,
            "barWidth1Star": 0
          },
          "link": "/Record/48485193",
          "transactionId": 3794408,
          "sortTitle": "Dogtown /",
          "create": 0,
          "expire": null,
          "automaticCancellation": null,
          "allowFreezeHolds": "1",
          "freezable": true,
          "currentPickupId": "TADL-WOOD",
          "currentPickupName": "Woodmere (Main) Branch",
          "location": "TADL-WOOD",
          "isbn": "1250811600",
          "upc": false,
          "format_category": "Books",
          "statusMessage": "Pending"
        }
      }
    }
  }
}
```

### changeHoldPickUpLocation same pickup

HTTP status: 200
Elapsed: 1990ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "changeHoldPickUpLocation",
    "holdId": 3794408,
    "newLocation": "7_TADL-WOOD",
    "newSublocation": "",
    "pickupBranch": "TADL-WOOD",
    "sublocation": "",
    "newPickupBranch": "TADL-WOOD"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, title: string, message: string } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "title": "Hold updated",
    "message": "The pickup location for the hold was changed."
  }
}
```

### freezeHold placed hold

HTTP status: 200
Elapsed: 2388ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "freezeHold",
    "holdId": 3794408,
    "recordId": 48485193,
    "itemSource": "ils"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, message: string, api: { title: string, message: string } } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "message": "Your hold was frozen successfully.",
    "api": {
      "title": "Hold frozen successfully",
      "message": "Your hold was frozen successfully."
    }
  }
}
```

### activateHold placed hold

HTTP status: 200
Elapsed: 2735ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "activateHold",
    "holdId": 3794408,
    "recordId": 48485193,
    "itemSource": "ils"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, message: string, api: { title: string, message: string } } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "message": "Your hold was thawed successfully.",
    "api": {
      "title": "Hold thawed successfully",
      "message": "Your hold was thawed successfully."
    }
  }
}
```

### cancelHold placed hold cleanup

HTTP status: 200
Elapsed: 2364ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "cancelHold",
    "cancelId": 3794408,
    "recordId": 48485193,
    "itemSource": "ils"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, title: string, message: string } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "title": "Hold cancelled",
    "message": "Your hold has been cancelled,"
  }
}
```

### getPatronHolds after cleanup

HTTP status: 200
Elapsed: 1172ms

Request:
```json
{
  "method": "POST",
  "path": "/API/UserAPI",
  "query": {
    "api": "tadl-prod",
    "method": "getPatronHolds",
    "refreshHolds": "true"
  },
  "body": {
    "username": "<username>",
    "password": "<password>"
  }
}
```

Response shape summary:
```text
{ result: { success: boolean, sortMethods: { unavailableSort: string, availableSort: string }, holds: { available: Array<empty>, unavailable: Array<empty> } } }
```

Sanitized response sample:
```json
{
  "result": {
    "success": true,
    "sortMethods": {
      "unavailableSort": "sortTitle",
      "availableSort": "expire"
    },
    "holds": {
      "available": [],
      "unavailable": []
    }
  }
}
```
