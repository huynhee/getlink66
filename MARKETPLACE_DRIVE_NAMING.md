# Marketplace Drive naming convention

Quy uoc nay dung cho tool upload model len Google Drive va cho admin scan folder vao MongoDB.
MongoDB chi luu metadata nhe va Drive file ID; file nang, anh preview va raw metadata nam tren Google Drive.

Quy chuan tong the cua pipeline nam trong `MARKETPLACE_DATA_CONTRACT.md`. File nay chi mo ta naming tren Drive.

## Folder structure

```text
/3dipl/
  /models/
    /6373049-outdoor-kitchen-145/
      model.zip
      model.sha256
      cover.jpg
      preview-01.jpg
      preview-02.png
      metadata.json.gz
```

Ten folder nen bat dau bang ma catalog nguon de tool upload de doi chieu:

```text
{catalogKey}-{slug}
```

Vi du:

```text
6373049-outdoor-kitchen-145
6212086-modern-chair
```

Folder cu dang co dang `{catalogKey}.{hash}` van scan duoc, nhung neu khong co `metadata.json.gz` thi web chi co the hien title fallback.

## Update flow

Scanner khong doc lai metadata cua toan bo catalog neu folder khong doi.
Moi model trong Mongo luu `driveFolderId`, `driveSignature`, `lastDriveScanAt`, `lastDriveChangeAt`.

- `created`: Drive folder chua co record trong Mongo.
- `updated`: Drive folder da co record nhung file list, modified time, ten file hoac size thay doi.
- `unchanged`: Drive folder da co record va signature giong lan scan truoc.

Khi sua metadata, cover, preview hoac file nen tren Drive, chi can scan lai root folder. Folder doi se duoc cap nhat, folder khong doi chi cap nhat moc scan.
Admin scan root theo batch bang `limit` va `pageToken`. Sau moi batch API tra `nextPageToken`; dung token do de quet tiep trang sau.
Voi bo lon 200k model, nen chay batch/worker nen theo page token hoac dung upload tool goi attach API ngay sau khi upload de khong phai cho mot request cuc lon chay het catalog.

## Required files

`model.zip`, `model.rar`, hoac `model.7z`

File nen chinh cua model. Scanner uu tien ten `model.*`. Neu khong co, scanner se tim `{sourceModelId}.*`, file trung ten folder, roi fallback sang file nen lon nhat.

`cover.jpg`, `cover.jpeg`, hoac `cover.png`

Anh thumbnail cho grid/list. Nen resize khoang 392-512px. JPG/JPEG nen duoi 200 KB neu duoc, PNG nen dung khi anh can nen trong suot.

`metadata.json.gz`

Thong tin model de hien thi title, category, render va filter co dinh. Nen gzip de tiet kiem dung luong Drive va bandwidth admin scan.

## Optional files

`preview-01.jpg`, `preview-02.jpeg`, `preview-03.png`, ...

Anh preview lon cho trang detail. Nen dung JPG/JPEG cho anh render thong thuong, PNG khi can nen trong suot. Kich thuoc nen khoang 1200px. Scanner sap xep theo so thu tu.

`model.sha256`

Text file chua checksum SHA-256 cua file nen. Dung cho plugin verify sau khi tai.

## metadata.json schema

```json
{
  "sourceModelId": "6373049",
  "title": "Outdoor Kitchen 145",
  "sourceSlug": "outdoor-kitchen-145",
  "sourceCategoryId": "barbecue-and-grill",
  "accessType": "member",
  "renderer": "Corona",
  "styles": ["modern"],
  "renderers": ["corona"],
  "forms": ["rectangle"],
  "colors": ["black", "wood"],
  "materials": ["metal", "wood"],
  "sizeText": "25 MB",
  "sha256": "64_hex_characters"
}
```

## Notes

- System keys de tieng Anh: `sourceModelId`, `renderers`, `materials`, `sha256`.
- `sourceModelId` chi dung de tool doi chieu/fallback title khi scan, khong expose ra public API va khong dung lam link ngoai.
- Khong luu URL nguon ngoai, version, format, polygon, ten file nen goc vao MongoDB.
- Khong luu `description` hoac `tags` cho marketplace model.
- UI co the hien thi tieng Viet rieng, khong doi key he thong.
- Khong luu raw metadata lon vao MongoDB. Scanner chi map cac field can query/display.
- Anh/file Drive khong public ra frontend. Frontend chi nhin thay URL proxy cua backend.
- Production nen cau hinh `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`; khong nen chi dung access token tinh vi token nay thuong het han nhanh va gay loi 401 khi stream cover/preview/file.
